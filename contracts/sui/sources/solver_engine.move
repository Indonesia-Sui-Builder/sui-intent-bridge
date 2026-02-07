module intent_bridge::solver_engine {
    use sui::coin::{Coin};
    use sui::sui::SUI;
    use sui::tx_context::sender;
    use wormhole::publish_message;
    use wormhole::emitter::{Self, EmitterCap};
    use wormhole::state::{State};

    /// Event emitted when a Wormhole message is published.
    /// This helps off-chain solvers track the message sequence number.
    public struct MessagePublished has copy, drop {
        sequence: u64,
        sender: address,
        intent_id: vector<u8>,
    }

    /// Holds the EmitterCap for the solver engine.
    /// This shared object allows the contract to send Wormhole messages.
    public struct SolverState has key, store {
        id: UID,
        emitter_cap: EmitterCap,
    }

    /// Initialize the module: create EmitterCap and share SolverState.
    /// Requires Wormhole State to register the emitter.
    fun init(ctx: &mut TxContext) {
        // We cannot create EmitterCap here without Wormhole State.
        // But init only gives us TxContext.
        // Strategy: Create a AdminCap or similar, and have a separate setup function.
        // However, for simplicity and standard patterns, we often assume we can create it later.
        // Actually, `wormhole::emitter::new` requires `&State`.
        // So we will not be able to create SolverState in init easily if we need `State`.
        // 
        // Alternative: The `solve_and_prove` can take `&mut EmitterCap` which is owned by the solver?
        // No, the contract itself (this module) should be the emitter usually.
        //
        // Let's check `wormhole::emitter::new` signature from previous view_file (it wasn't fully shown but usage was in tests).
        // `wormhole::emitter::new(&worm_state, ctx)`
        //
        // Since we can't get `worm_state` in init, we must do a post-deploy setup.
        
        let deployer = sender(ctx);
        // Transfer an AdminCap to deployer to allow setup
        transfer::transfer(AdminCap { id: object::new(ctx) }, deployer);
    }

    public struct AdminCap has key, store {
        id: UID
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
    ///
    /// # Arguments
    /// * `solver_state` - The shared object holding the EmitterCap.
    /// * `wormhole_state` - The Wormhole state object.
    /// * `payment_coin` - The SUI coin to be transferred to the recipient.
    /// * `recipient` - The address of the user who initiated the intent (on Sui).
    /// * `intent_id` - The unique ID of the intent (from the source chain).
    /// * `clock` - The Sui clock.
    public fun solve_and_prove(
        solver_state: &mut SolverState,
        wormhole_state: &mut State,
        payment_coin: Coin<SUI>,
        message_fee: Coin<SUI>,
        recipient: address,
        intent_id: vector<u8>,
        clock: &sui::clock::Clock,
        ctx: &mut TxContext
    ): u64 {
        // 1. Transfer Payment to Recipient (Action 1)
        transfer::public_transfer(payment_coin, recipient);

        // 2. Construct Payload (Action 2)
        // Payload = intent_id (bytes) + solver_address (bytes)
        let mut payload = vector::empty<u8>();
        vector::append(&mut payload, intent_id);
        
        let solver_addr = sender(ctx);
        let solver_proto = sui::bcs::to_bytes(&solver_addr);
        vector::append(&mut payload, solver_proto);

        // 3. Prepare Message (Create MessageTicket)
        let ticket = publish_message::prepare_message(
            &mut solver_state.emitter_cap,
            0, // nonce
            payload
        );

        // 4. Publish Wormhole Message (Action 3)
        let sequence = publish_message::publish_message(
            wormhole_state,
            message_fee,
            ticket,
            clock
        );

        // Emit event for tracking
        sui::event::emit(MessagePublished {
            sequence,
            sender: solver_addr,
            intent_id,
        });

        sequence
    }
}
