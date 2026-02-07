/// Module: my_bridge::intent
/// 
/// Self-Hosted Intent Bridge for Sui → EVM cross-chain swaps.
/// 
/// HACKATHON MVP: Uses whitelisted solver instead of ZK proofs.
/// 
/// PRODUCTION NOTE: In production, you would replace the solver whitelist with:
/// - ZK proof verification (e.g., using SP1, Risc0)
/// - Wormhole VAA verification for cross-chain message attestation
/// - Multi-sig solver committees with slashing conditions
module intent_bridge::intent {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::bcs;
    use wormhole::vaa;
    use wormhole::external_address::{Self};
    use wormhole::state::{State};
    use sui::clock::{Clock};

    // ============ Error Codes ============
    
    /// Caller is not the authorized solver in the VAA
    const ENotAuthorizedSolver: u64 = 0;
    /// Invalid EVM address length (must be 20 bytes)
    const EInvalidEvmAddress: u64 = 1;
    /// Amount must be greater than zero
    const EZeroAmount: u64 = 2;
    /// Invalid Wormhole Source Chain
    const EInvalidChain: u64 = 3;
    /// Invalid Wormhole Emitter Address
    const EInvalidEmitter: u64 = 4;
    /// Intent ID in VAA does not match this object
    const EInvalidIntentId: u64 = 5;

    // ============ Structs ============

    /// Intent: A shared object representing a user's cross-chain swap intent.
    /// 
    /// The user locks SUI in this object, specifying:
    /// - recipient_evm: Their EVM address to receive ETH
    /// - amount_expected: The amount of ETH (in wei) they expect
    /// 
    /// The solver fulfills this by sending ETH on Base Sepolia,
    /// then claims the locked SUI as payment.
    public struct Intent has key {
        id: UID,
        /// The locked SUI balance
        input_balance: Balance<SUI>,
        /// User's EVM address to receive ETH (20 bytes)
        recipient_evm: vector<u8>,
        /// Amount of ETH expected in wei (for display/verification)
        amount_expected: u64,
        /// Original creator of the intent
        creator: address,
    }

    /// SolverConfig: Admin-controlled configuration for whitelisted solvers.
    /// 
    /// HACKATHON SIMPLIFICATION: Only one solver is whitelisted.
    /// 
    /// PRODUCTION: This would be replaced with:
    /// - On-chain proof verification (ZK proofs)
    /// - Wormhole message verification
    /// - Decentralized solver registry with staking
    public struct SolverConfig has key {
        id: UID,
        /// The whitelisted solver address (fallback / admin controlled)
        solver_address: address,
        /// Admin who can update solver
        admin: address,
        /// Required Wormhole Chain ID (e.g. 10002 for Base Sepolia)
        required_emitter_chain: u16,
        /// Required Wormhole Emitter Address (32 bytes)
        required_emitter_address: vector<u8>,
    }

    // ============ Events ============

    /// Emitted when a user creates a new intent
    public struct IntentCreated has copy, drop {
        /// Unique ID of the intent object
        intent_id: address,
        /// Address of the user who created the intent
        creator: address,
        /// Amount of SUI locked (in MIST, 1 SUI = 1e9 MIST)
        sui_amount: u64,
        /// User's EVM address to receive ETH
        recipient_evm: vector<u8>,
        /// Expected ETH amount in wei
        eth_amount_expected: u64,
    }

    /// Emitted when a solver claims an intent
    public struct IntentClaimed has copy, drop {
        /// ID of the claimed intent
        intent_id: address,
        /// Address of the solver who claimed
        solver: address,
        /// Amount of SUI transferred to solver
        sui_amount: u64,
    }

    // ============ Init Function ============

    /// Module initializer - creates the SolverConfig with deployer as admin and solver
    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        
        let config = SolverConfig {
            id: object::new(ctx),
            solver_address: sender, // Deployer is initial solver
            admin: sender,
            required_emitter_chain: 10004, // Default to Base Sepolia (check Wormhole ID)
            required_emitter_address: vector::empty(), // Needs update
        };
        
        transfer::share_object(config);
    }

    // ============ Public Entry Functions ============

    /// Create a new intent to swap SUI for ETH on Base Sepolia.
    /// 
    /// The user's SUI is locked in a shared Intent object.
    /// A solver will detect this via events, send ETH on EVM, then claim the SUI.
    /// 
    /// # Arguments
    /// * `payment` - The SUI coin to lock
    /// * `recipient_evm` - User's EVM address (20 bytes, e.g., 0x1234...abcd without 0x prefix)
    /// * `eth_amount_expected` - Amount of ETH expected in wei
    /// 
    /// # Example
    /// ```
    /// // Lock 1 SUI, expect 0.0001 ETH (100000000000000 wei)
    /// create_intent(sui_coin, evm_address_bytes, 100000000000000);
    /// ```
    public fun create_intent(
        payment: Coin<SUI>,
        recipient_evm: vector<u8>,
        eth_amount_expected: u64,
        ctx: &mut TxContext
    ) {
        // Validate EVM address (20 bytes)
        assert!(vector::length(&recipient_evm) == 20, EInvalidEvmAddress);
        
        let sui_amount = coin::value(&payment);
        assert!(sui_amount > 0, EZeroAmount);
        
        let creator = tx_context::sender(ctx);
        
        let intent = Intent {
            id: object::new(ctx),
            input_balance: coin::into_balance(payment),
            recipient_evm,
            amount_expected: eth_amount_expected,
            creator,
        };
        
        let intent_id = object::uid_to_address(&intent.id);
        
        // Emit event for solver detection
        event::emit(IntentCreated {
            intent_id,
            creator,
            sui_amount,
            recipient_evm: intent.recipient_evm,
            eth_amount_expected,
        });
        
        // Share the intent so solver can access it
        transfer::share_object(intent);
    }

    /// Claim an intent after fulfilling it on the EVM side.
    /// 
    /// HACKATHON SECURITY MODEL:
    /// Only the whitelisted solver can call this function.
    /// The solver is trusted to have sent the ETH before calling claim.
    /// 
    /// PRODUCTION SECURITY MODEL:
    /// This would require one of:
    /// 1. ZK Proof that the EVM transaction occurred (SP1/Risc0)
    /// 2. Wormhole VAA proving the cross-chain message
    /// 3. Oracle attestation from trusted parties
    /// 4. Optimistic verification with challenge period
    /// 
    /// # Arguments
    /// * `intent` - The intent to claim
    /// * `config` - The solver configuration (for authorization)
    public fun claim_intent(
        intent: Intent,
        config: &SolverConfig,
        wormhole_state: &State,
        clock: &Clock,
        vaa_buf: vector<u8>,
        ctx: &mut TxContext
    ) {
        // 1. Verify VAA signatures
        let vaa = vaa::parse_and_verify(wormhole_state, vaa_buf, clock);

        // 2. Verify Emitter Chain
        assert!(vaa::emitter_chain(&vaa) == config.required_emitter_chain, EInvalidChain);

        // 3. Verify Emitter Address
        let emitter_ext = vaa::emitter_address(&vaa);
        let emitter_bytes = external_address::to_bytes(emitter_ext);
        assert!(emitter_bytes == config.required_emitter_address, EInvalidEmitter);

        // 4. Extract Payload
        // VAA Payload Structure: [Intent ID (32 bytes) | Solver Address (32 bytes)] = 64 bytes total
        let payload = vaa::take_payload(vaa);
        // Note: Payload from EVM `abi.encode(bytes32, bytes32)` is exactly 64 bytes.
        
        // Split payload
        let mut intent_id_vec = vector::empty<u8>();
        let mut solver_vec = vector::empty<u8>();
        
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut intent_id_vec, *vector::borrow(&payload, i));
            i = i + 1;
        };
        
        while (i < 64) {
             vector::push_back(&mut solver_vec, *vector::borrow(&payload, i));
             i = i + 1;
        };

        // 5. Verify Intent Match
        // Convert Intent ID (UID) to address then bytes
        let intent_id = object::uid_to_address(&intent.id);
        let intent_id_bytes = bcs::to_bytes(&intent_id);
        assert!(intent_id_bytes == intent_id_vec, EInvalidIntentId);

        // 6. Verify Solver Authorization
        // The VAA claims that `solver_vec` (Sui Address in bytes) was the one who fulfilled it.
        // We verify that the transaction sender matches this address.
        let caller = tx_context::sender(ctx);
        let caller_bytes = bcs::to_bytes(&caller);
        assert!(caller_bytes == solver_vec, ENotAuthorizedSolver);
        
        let Intent {
            id,
            input_balance,
            recipient_evm: _,
            amount_expected: _,
            creator: _,
        } = intent;
        
        let intent_id = object::uid_to_address(&id);
        let sui_amount = balance::value(&input_balance);
        
        // Transfer locked SUI to solver
        let sui_coin = coin::from_balance(input_balance, ctx);
        transfer::public_transfer(sui_coin, caller);
        
        // Emit claim event
        event::emit(IntentClaimed {
            intent_id,
            solver: caller,
            sui_amount,
        });
        
        // Delete the intent object
        object::delete(id);
    }

    /// Update the whitelisted solver address (admin only).
    /// 
    /// # Arguments
    /// * `config` - The solver configuration
    /// * `new_solver` - The new solver address
    public fun update_solver_config(
        config: &mut SolverConfig,
        new_solver: address,
        new_chain: u16,
        new_emitter: vector<u8>,
        ctx: &TxContext
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAuthorizedSolver);
        config.solver_address = new_solver;
        config.required_emitter_chain = new_chain;
        config.required_emitter_address = new_emitter;
    }

    // ============ View Functions ============

    /// Get the locked SUI amount in an intent
    public fun get_intent_amount(intent: &Intent): u64 {
        balance::value(&intent.input_balance)
    }

    /// Get the expected ETH amount
    public fun get_expected_eth(intent: &Intent): u64 {
        intent.amount_expected
    }

    /// Get the recipient EVM address
    public fun get_recipient_evm(intent: &Intent): vector<u8> {
        intent.recipient_evm
    }

    /// Get the intent creator
    public fun get_creator(intent: &Intent): address {
        intent.creator
    }

    /// Get the current whitelisted solver
    public fun get_solver(config: &SolverConfig): address {
        config.solver_address
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
