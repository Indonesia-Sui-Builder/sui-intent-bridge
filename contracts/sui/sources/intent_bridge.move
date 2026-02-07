module intent_bridge::main {
    use sui::sui::SUI;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::table::{Self, Table};
    use sui::event;
    use sui::clock::{Self, Clock};
    use wormhole::emitter::{Self, EmitterCap};
    use wormhole::publish_message;
    use wormhole::state::{State};
    use wormhole::vaa::{Self};
    use wormhole::external_address::{Self};
    use std::vector;

    // ============ Error Codes ============
    
    // Feature A: Outbound (Sui -> EVM)
    const EBidTooLow: u64 = 0;
    const EInvalidEvmAddr: u64 = 1;
    const ENotOwner: u64 = 2; // unused
    const EOrderExpired: u64 = 3; // unused
    const EReplayDetected: u64 = 4;
    const EInvalidChain: u64 = 5;
    const EInvalidEmitter: u64 = 6;
    const EInvalidOrderId: u64 = 7;
    const EZeroAmount: u64 = 8;
    
    // Feature B: Inbound (EVM -> Sui)
    const EInsufficientFunds: u64 = 9;

    // ============ Shared State ============

    public struct BridgeState has key {
        id: UID,
        emitter_cap: EmitterCap,
        processed_vaas: Table<vector<u8>, bool>, // keccak256 hash -> processed
        // Config for expected EVM source
        required_chain: u16,
        required_address: vector<u8>,
    }

    // ============ Feature A: Outbound Structs (Sui -> EVM) ============

    public struct Order has key, store {
        id: UID,
        input_balance: Balance<SUI>,
        owner: address,
        // Auction Params
        start_amount: u64,
        min_amount: u64,
        start_time: u64,
        duration: u64,
        recipient_evm: vector<u8>, // 20 bytes
    }

    // ============ Events ============

    public struct OrderCreated has copy, drop {
        order_id: address,
        owner: address,
        input_amount: u64,
        start_amount: u64,
        min_amount: u64,
        start_time: u64,
        duration: u64,
        recipient_evm: vector<u8>,
    }

    public struct OrderClaimed has copy, drop {
        order_id: address,
        solver: address,
        amount_claimed: u64,
    }
    
    public struct MessagePublished has copy, drop {
        sequence: u64,
        sender: address,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    public struct AdminCap has key, store { id: UID }

    public fun initialize(
        _: &AdminCap,
        wormhole_state: &State,
        required_chain: u16,
        required_address: vector<u8>,
        ctx: &mut TxContext
    ) {
        let emitter_cap = emitter::new(wormhole_state, ctx);
        let state = BridgeState {
            id: object::new(ctx),
            emitter_cap,
            processed_vaas: table::new(ctx),
            required_chain,
            required_address,
        };
        transfer::share_object(state);
    }

    // ============ Feature A: Outbound (Sui -> EVM) ============

    public fun create_order(
        payment: Coin<SUI>,
        start_amount: u64,
        min_amount: u64,
        duration: u64,
        recipient_evm: vector<u8>, // 20 bytes
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let input_amount = coin::value(&payment);
        assert!(input_amount > 0, EZeroAmount);
        assert!(vector::length(&recipient_evm) == 20, EInvalidEvmAddr);

        let start_time = clock::timestamp_ms(clock);
        
        let order = Order {
            id: object::new(ctx),
            input_balance: coin::into_balance(payment),
            owner: tx_context::sender(ctx),
            start_amount,
            min_amount,
            start_time,
            duration,
            recipient_evm,
        };

        let order_id = object::uid_to_address(&order.id);
        
        event::emit(OrderCreated {
            order_id,
            owner: order.owner,
            input_amount,
            start_amount,
            min_amount,
            start_time,
            duration,
            recipient_evm,
        });

        transfer::share_object(order);
    }

    public fun claim_order(
        state: &mut BridgeState,
        order: Order, // Consume order
        wormhole_state: &State,
        encoded_vaa: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // 1. Verify VAA
        let vaa = vaa::parse_and_verify(wormhole_state, encoded_vaa, clock);
        
        // 2. Replay Protection
        let digest = vaa::digest(&vaa);
        let hash_vec = bytes32_to_vector(digest);
        assert!(!table::contains(&state.processed_vaas, hash_vec), EReplayDetected);
        table::add(&mut state.processed_vaas, hash_vec, true);

        // 3. Verify Emitter
        assert!(vaa::emitter_chain(&vaa) == state.required_chain, EInvalidChain);
        let emitter_addr = external_address::to_bytes(vaa::emitter_address(&vaa));
        assert!(emitter_addr == state.required_address, EInvalidEmitter);

        // 4. Parse Payload
        // Expected: [Order ID (32 bytes)][Solver SUI Address (32 bytes)][Amount Paid (32 bytes BE)]
        
        let timestamp = vaa::timestamp(&vaa); // seconds
        let payload = vaa::take_payload(vaa);
        
        // A. Order ID
        let mut order_id_vec = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 32) { vector::push_back(&mut order_id_vec, *vector::borrow(&payload, i)); i = i + 1; };

        // Verify Order ID matches
        let order_uid = object::uid_to_address(&order.id);
        let order_id_bytes = address_to_bytes(order_uid);
        assert!(order_id_bytes == order_id_vec, EInvalidOrderId);

        // B. Solver SUI Address
        let mut solver_addr_bytes = vector::empty<u8>();
        let mut j = 32u64;
        while (j < 64) { vector::push_back(&mut solver_addr_bytes, *vector::borrow(&payload, j)); j = j + 1; };
        let solver_addr = bytes_to_address(solver_addr_bytes);

        // C. Amount Paid (last 32 bytes)
        let mut amount_bytes = vector::empty<u8>();
        let mut k = 88u64; // 64 + 24
        while (k < 96) { vector::push_back(&mut amount_bytes, *vector::borrow(&payload, k)); k = k + 1; };
        let amount_paid = bytes_to_u64_be(amount_bytes);

        // 5. Dutch Auction Check
        let vaa_time_ms = (timestamp as u64) * 1000;
        let required_amount = calculate_dutch_price(order.start_amount, order.min_amount, order.start_time, order.duration, vaa_time_ms);
        
        assert!(amount_paid >= required_amount, EBidTooLow);

        // 6. Transfer SUI to Solver
        let Order { id, input_balance, owner: _, start_amount: _, min_amount: _, start_time: _, duration: _, recipient_evm: _ } = order;
        let amount = balance::value(&input_balance);
        let payment = coin::from_balance(input_balance, ctx);
        transfer::public_transfer(payment, solver_addr);
        
        event::emit(OrderClaimed {
            order_id: order_uid,
            solver: solver_addr,
            amount_claimed: amount,
        });
        object::delete(id);
    }

    // ============ Feature B: Inbound (EVM -> Sui) ============

    public fun solve_and_prove(
        state: &mut BridgeState,
        wormhole_state: &mut State,
        mut coin_in: Coin<SUI>,
        message_fee: Coin<SUI>, // Fee coin
        amount_to_send: u64,
        recipient: address,
        intent_id: vector<u8>,
        solver_address: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let coin_val = coin::value(&coin_in);
        assert!(coin_val >= amount_to_send, EInsufficientFunds);

        // Split exact amount
        let transfer_coin = coin::split(&mut coin_in, amount_to_send, ctx);
        transfer::public_transfer(transfer_coin, recipient);
        
        // Refund remainder
        if (coin::value(&coin_in) > 0) {
            transfer::public_transfer(coin_in, tx_context::sender(ctx));
        } else {
            coin::destroy_zero(coin_in);
        };

        // Payload
        let mut payload = vector::empty<u8>();
        vector::append(&mut payload, intent_id);
        
        let sn = vector::length(&solver_address);
        if (sn < 32) {
             let mut p = 0u64;
             while (p < 32 - sn) { vector::push_back(&mut payload, 0); p = p + 1; };
        };
        vector::append(&mut payload, solver_address);

        let mut pad = 0u64;
        while (pad < 24) { vector::push_back(&mut payload, 0); pad = pad + 1; };
        let amount_bytes = u64_to_bytes_be(amount_to_send);
        vector::append(&mut payload, amount_bytes);

        // Publish Message (nonce is u32)
        let ticket = publish_message::prepare_message(
            &mut state.emitter_cap,
            0u32, // nonce fixed type
            payload,
        );

        let seq = publish_message::publish_message(
            wormhole_state,
            message_fee,
            ticket,
            clock
        );

        event::emit(MessagePublished {
            sequence: seq,
            sender: tx_context::sender(ctx),
        });
    }

    // ============ Helper Functions ============

    public fun calculate_dutch_price(start: u64, min: u64, start_time: u64, duration: u64, current_time: u64): u64 {
        if (current_time <= start_time) return start;
        let elapsed = current_time - start_time;
        if (elapsed >= duration) return min;
        
        let total_drop = start - min;
        let drop = ((total_drop as u128) * (elapsed as u128)) / (duration as u128);
        start - (drop as u64)
    }

    fun bytes_to_u64_be(bytes: vector<u8>): u64 {
        let mut val: u64 = 0;
        let mut i = 0u64;
        while (i < 8) {
            let b = *vector::borrow(&bytes, i);
            val = (val << 8) | (b as u64);
            i = i + 1;
        };
        val
    }

    fun u64_to_bytes_be(val: u64): vector<u8> {
        let mut bytes = vector::empty<u8>();
        let mut v = val;
        let mut i = 0u64;
        while (i < 8) {
            let b = ((v & 0xFF) as u8);
            vector::push_back(&mut bytes, b);
            v = v >> 8;
            i = i + 1;
        };
        vector::reverse(&mut bytes);
        bytes
    }
    
    fun address_to_bytes(addr: address): vector<u8> {
        sui::bcs::to_bytes(&addr)
    }

    fun bytes_to_address(bytes: vector<u8>): address {
        let mut bcs = sui::bcs::new(bytes);
        sui::bcs::peel_address(&mut bcs)
    }

    fun bytes32_to_vector(bytes: wormhole::bytes32::Bytes32): vector<u8> {
        wormhole::bytes32::to_bytes(bytes)
    }
}
