module intent_bridge::solver_engine {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::tx_context::sender;
    use sui::transfer;
    use sui::object::{Self, UID};
    use std::vector;
    use wormhole::publish_message;
    use wormhole::emitter::{Self, EmitterCap};
    use wormhole::state::{State};
    use sui::clock::{Clock};

    /// Event emitted when a Wormhole message is published.
    /// This helps off-chain solvers track the message sequence number.
    public struct MessagePublished has copy, drop {
        sequence: u64,
        sender: address,
        intent_id: vector<u8>,
        amount_sent: u64,
    }

    /// Holds the EmitterCap for the solver engine.
    /// This shared object allows the contract to send Wormhole messages.
    public struct SolverState has key, store {
        id: UID,
        emitter_cap: EmitterCap,
    }

    public struct AdminCap has key, store {
        id: UID
    }

    /// Initialize the module
    fun init(ctx: &mut TxContext) {
        let deployer = sender(ctx);
        transfer::transfer(AdminCap { id: object::new(ctx) }, deployer);
    }

    /// Register the emitter. Must be called once after deployment.
    public fun register_emitter(
        _: &AdminCap,
        wormhole_state: &State,
        ctx: &mut TxContext
    ) {
        let emitter_cap = emitter::new(wormhole_state, ctx);
        transfer::share_object(SolverState {
            id: object::new(ctx),
            emitter_cap
        });
    }

    /// Solves a cross-chain intent by transferring SUI to the user and proving it via Wormhole.
    /// Updated for Dutch Auction: Sends specific amount, returns change, and includes amount in payload.
    ///
    /// # Arguments
    /// * `solver_state` - The shared object holding the EmitterCap.
    /// * `wormhole_state` - The Wormhole state object.
    /// * `payment_coins` - Vector of SUI coins to be used for the payment (will be merged).
    /// * `message_fee` - The SUI coin for Wormhole fee.
    /// * `recipient` - The address of the user who initiated the intent (on Sui).
    /// * `intent_id` - The unique ID of the intent (from the source chain).
    /// * `amount_to_send` - The exact amount of SUI to satisfy the auction.
    /// * `solver_evm_address` - The EVM address (20 bytes) of the solver to receive funds on source chain.
    /// * `clock` - The Sui clock.
    public fun solve_and_prove(
        solver_state: &mut SolverState,
        wormhole_state: &mut State,
        mut payment_coins: vector<Coin<SUI>>,
        message_fee: Coin<SUI>,
        recipient: address,
        intent_id: vector<u8>,
        amount_to_send: u64,
        solver_evm_address: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ): u64 {
        let solver_addr = sender(ctx);

        // 1. Merge Coins
        assert!(vector::length(&payment_coins) > 0, 0);
        let mut coin_to_send = vector::pop_back(&mut payment_coins);
        pay_all(&mut coin_to_send, payment_coins);

        // 2. Ensure value sufficient
        assert!(coin::value(&coin_to_send) >= amount_to_send, 1);

        // 3. Split Exact Amount
        // If exact match, just use it. If more, split.
        let transfer_coin = if (coin::value(&coin_to_send) == amount_to_send) {
             coin_to_send
        } else {
             let split = coin::split(&mut coin_to_send, amount_to_send, ctx);
             // Refund remainder to Solver
             transfer::public_transfer(coin_to_send, solver_addr);
             split
        };
        
        // 4. Transfer exact amount to Recipient
        transfer::public_transfer(transfer_coin, recipient);

        // 5. Construct Payload
        // Payload Layout for EVM abi.decode(payload, (uint256, address, uint256)):
        // A. intent_id (32 bytes)
        // B. solver_evm_address (32 bytes padded)
        // C. amount_sent (32 bytes padded)
        
        let mut payload = vector::empty<u8>();
        
        // A. Intent ID: Assuming it's already a 32-byte orderId from EVM
        vector::append(&mut payload, intent_id);

        // B. Solver EVM Address: Pad to 32 bytes (12 bytes zero padding for address type in ABI)
        // Ensure input is 20 bytes
        assert!(vector::length(&solver_evm_address) == 20, 2);
        let mut k = 0;
        let mut pad_addr = vector::empty<u8>();
        while (k < 12) {
            vector::push_back(&mut pad_addr, 0);
            k = k + 1;
        };
        vector::append(&mut payload, pad_addr);
        vector::append(&mut payload, solver_evm_address);

        // C. Amount Sent: Pad u64 to 32 bytes Big Endian
        // 24 bytes of zeros
        let mut j = 0;
        let mut pad_amount = vector::empty<u8>();
        while (j < 24) {
             vector::push_back(&mut pad_amount, 0);
             j = j + 1;
        };
        vector::append(&mut payload, pad_amount);
        
        // 8 bytes of u64 Big Endian
        let amount_bytes = u64_to_bytes_be(amount_to_send);
        vector::append(&mut payload, amount_bytes);


        // 6. Publish Wormhole Message
        let ticket = publish_message::prepare_message(
            &mut solver_state.emitter_cap,
            0, // nonce
            payload
        );

        let sequence = publish_message::publish_message(
            wormhole_state,
            message_fee,
            ticket,
            clock
        );

        sui::event::emit(MessagePublished {
            sequence,
            sender: solver_addr,
            intent_id: copy intent_id, // Copy to use in event
            amount_sent: amount_to_send,
        });

        sequence
    }

    /// Helper to merge a vector of coins into one
    fun pay_all<T>(target: &mut Coin<T>, mut source: vector<Coin<T>>) {
        while (!vector::is_empty(&source)) {
            let c = vector::pop_back(&mut source);
            coin::join(target, c);
        };
        vector::destroy_empty(source);
    }

    /// Helper to serialize u64 to 8 bytes Big Endian
    fun u64_to_bytes_be(val: u64): vector<u8> {
        let mut bytes = vector::empty<u8>();
        let mut i = 0;
        let mut temp = val;
        
        // Extract bytes in Little Endian order first
        while (i < 8) {
            let byte = ((temp & 0xFF) as u8);
            vector::push_back(&mut bytes, byte);
            temp = temp >> 8;
            i = i + 1;
        };
        // Reverse to get Big Endian
        vector::reverse(&mut bytes);
        bytes
    }
}
