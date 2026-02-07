module intent_bridge::intent {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::bcs;
    use wormhole::vaa::{Self};
    use wormhole::external_address::{Self};
    use wormhole::state::{State};
    use sui::clock::{Self, Clock};
    use std::vector;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    // ============ Error Codes ============
    
    const ENotAuthorizedSolver: u64 = 0;
    const EInvalidEvmAddress: u64 = 1;
    const EZeroAmount: u64 = 2;
    const EInvalidChain: u64 = 3;
    const EInvalidEmitter: u64 = 4;
    const EInvalidIntentId: u64 = 5;
    const EBidTooLow: u64 = 6;

    // ============ Structs ============

    /// Intent: A shared object representing a user's cross-chain swap intent with Dutch Auction.
    public struct Intent has key, store {
        id: UID,
        /// The locked SUI balance to be released to solver
        input_balance: Balance<SUI>,
        /// User's EVM address to receive ETH (20 bytes)
        recipient_evm: vector<u8>,
        /// Auction: Starting amount of ETH expected (in wei)
        start_output_amount: u64,
        /// Auction: Minimum amount of ETH expected (floor)
        min_output_amount: u64,
        /// Auction: Start timestamp (ms)
        start_time: u64,
        /// Auction: Duration (ms)
        duration: u64,
        /// Original creator of the intent
        creator: address,
    }

    public struct SolverConfig has key, store {
        id: UID,
        admin: address,
        required_emitter_chain: u16,
        required_emitter_address: vector<u8>,
    }

    // ============ Events ============

    public struct IntentCreated has copy, drop {
        intent_id: address,
        creator: address,
        sui_amount: u64,
        recipient_evm: vector<u8>,
        start_output_amount: u64,
        min_output_amount: u64,
        start_time: u64,
        duration: u64,
    }

    public struct IntentClaimed has copy, drop {
        intent_id: address,
        solver: address,
        sui_amount: u64,
    }

    // ============ Init Function ============

    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        
        // Initial dummy config, updated by admin later
        let config = SolverConfig {
            id: object::new(ctx),
            admin: sender,
            required_emitter_chain: 10004, // Base Sepolia
            required_emitter_address: vector::empty(),
        };
        
        transfer::share_object(config);
    }

    // ============ Public Entry Functions ============

    /// Create a new Dutch Auction intent.
    public fun create_intent(
        payment: Coin<SUI>,
        recipient_evm: vector<u8>,
        start_output_amount: u64,
        min_output_amount: u64,
        duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sui_amount = coin::value(&payment);
        assert!(sui_amount > 0, EZeroAmount);
        assert!(vector::length(&recipient_evm) == 20, EInvalidEvmAddress);
        
        let creator = tx_context::sender(ctx);
        let start_time = clock::timestamp_ms(clock);
        
        let intent = Intent {
            id: object::new(ctx),
            input_balance: coin::into_balance(payment),
            recipient_evm,
            start_output_amount,
            min_output_amount,
            start_time,
            duration,
            creator,
        };
        
        let intent_id = object::uid_to_address(&intent.id);
        
        event::emit(IntentCreated {
            intent_id,
            creator,
            sui_amount,
            recipient_evm: intent.recipient_evm,
            start_output_amount,
            min_output_amount,
            start_time,
            duration
        });
        
        transfer::share_object(intent);
    }

    /// Claim an intent using a Wormhole VAA that proves fulfillment on EVM.
    /// VAA Payload must be: [IntentID (32b)] [SolverAddress (32b, padded)] [AmountPaid (32b, padded)]
    public fun claim_intent(
        intent: Intent,
        config: &SolverConfig,
        wormhole_state: &State,
        clock: &Clock,
        vaa_buf: vector<u8>,
        ctx: &mut TxContext
    ) {
        // 1. Verify VAA
        let vaa = vaa::parse_and_verify(wormhole_state, vaa_buf, clock);

        // 2. Verify Emitter
        assert!(vaa::emitter_chain(&vaa) == config.required_emitter_chain, EInvalidChain);
        let emitter_ext = vaa::emitter_address(&vaa);
        let emitter_bytes = external_address::to_bytes(emitter_ext);
        assert!(emitter_bytes == config.required_emitter_address, EInvalidEmitter);

        // 3. Extract Payload (96 bytes expected: 32ID + 32Solver + 32Amount)
        // Correct order: take timestamp first (borrow), then payload (move/consume)
        let timestamp = vaa::timestamp(&vaa); // Seconds
        let payload = vaa::take_payload(vaa);
        
        // A. Intent ID (0-32)
        let mut intent_id_vec = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut intent_id_vec, *vector::borrow(&payload, i));
            i = i + 1;
        };

        // B. Solver Address (32-64)
        let mut solver_vec = vector::empty<u8>();
        while (i < 64) {
             vector::push_back(&mut solver_vec, *vector::borrow(&payload, i));
             i = i + 1;
        };

        // C. Amount Paid (64-96)
        let mut amount_bytes = vector::empty<u8>();
        let mut k = 88; // Last 8 bytes of the 32-byte chunk starting at 64 (so 64+24 = 88)
        while (k < 96) {
            vector::push_back(&mut amount_bytes, *vector::borrow(&payload, k));
            k = k + 1;
        };
        let amount_paid = bytes_to_u64_be(amount_bytes);

        // 4. Verify Intent Match
        let intent_id_addr = object::uid_to_address(&intent.id);
        let intent_id_bytes = bcs::to_bytes(&intent_id_addr);
        assert!(intent_id_bytes == intent_id_vec, EInvalidIntentId);

        // 5. Verify Solver Authorization
        let caller = tx_context::sender(ctx);
        let caller_bytes = bcs::to_bytes(&caller);
        assert!(caller_bytes == solver_vec, ENotAuthorizedSolver);

        // 6. Verify Dutch Auction Price
        let vaa_time_ms = (timestamp as u64) * 1000;
        let required_amount = calculate_required_amount_internal(
            intent.start_output_amount,
            intent.min_output_amount,
            intent.start_time,
            intent.duration,
            vaa_time_ms
        );
        
        assert!(amount_paid >= required_amount, EBidTooLow);

        // 7. Payout
        let Intent {
            id,
            input_balance,
            recipient_evm: _,
            start_output_amount: _,
            min_output_amount: _,
            start_time: _,
            duration: _,
            creator: _,
        } = intent; 

        let sui_amount = balance::value(&input_balance);
        let sui_coin = coin::from_balance(input_balance, ctx);
        transfer::public_transfer(sui_coin, caller);
        
        event::emit(IntentClaimed {
            intent_id: intent_id_addr,
            solver: caller,
            sui_amount
        });
        
        object::delete(id);
    }

    fun bytes_to_u64_be(bytes: vector<u8>): u64 {
        let mut value: u64 = 0;
        let mut i = 0;
        let len = vector::length(&bytes);
        while (i < len) {
            let b = *vector::borrow(&bytes, i);
            value = (value << 8) | (b as u64);
            i = i + 1;
        };
        value
    }
    
    // ============ Helper Functions ============

    public fun calculate_required_amount_internal(
        start_amount: u64,
        min_amount: u64,
        start_time: u64,
        duration: u64,
        current_time_ms: u64
    ): u64 {
        if (current_time_ms <= start_time) {
            return start_amount
        };

        let elapsed = current_time_ms - start_time;
        
        if (elapsed >= duration) {
            return min_amount
        };

        let total_drop = start_amount - min_amount;
        let drop = ((total_drop as u128) * (elapsed as u128)) / (duration as u128);
        
        start_amount - (drop as u64)
    }

    public fun update_solver_config(
        config: &mut SolverConfig,
        new_chain: u16,
        new_emitter: vector<u8>,
        ctx: &TxContext
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAuthorizedSolver);
        config.required_emitter_chain = new_chain;
        config.required_emitter_address = new_emitter;
    }
}
