// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/IntentVault.sol";
import {ICoreBridge} from "wormhole-solidity-sdk/interfaces/ICoreBridge.sol";

contract ForkTest is Test {
    IntentVault vault;
    address usdc;

    // Base Sepolia Wormhole Core Bridge
    address constant WORMHOLE = 0x2703483B1a5a7c577e8680de9Df8Be03c6f30e3c; // 0x27...

    // Mock Sui Emitter (32 bytes)
    bytes32 constant SUI_EMITTER = bytes32(uint256(1));

    function setUp() public {
        // Use fake USDC address since we only test ETH path
        usdc = makeAddr("usdc");
        vault = new IntentVault(usdc, WORMHOLE, SUI_EMITTER);
    }

    function testFulfillOrderWithRealWormhole() public {
        // 1. Setup
        bytes32 intentId = keccak256("intent_1");
        address payable user = payable(makeAddr("user"));
        bytes32 solverSuiAddr = bytes32(uint256(2));
        uint256 amount = 0.01 ether;

        // SKIP Fee Query - assume 0
        uint256 fee = 0;
        uint256 total = amount + fee;

        // 2. Act
        // Impersonate a solver with ETH
        address solver = makeAddr("solver");
        vm.deal(solver, total);

        vm.prank(solver);
        // This call will fail if the WORMHOLE address is not a contract (i.e. if not forked correctly)
        uint64 sequence = vault.fulfillOrder{value: total}(
            intentId,
            user,
            solverSuiAddr,
            amount
        );

        // 3. Assert
        // User received ETH
        assertEq(user.balance, amount);

        // Sequence returned indicates successful call to Wormhole
        console.log("Wormhole Sequence:", sequence);
        assertTrue(sequence > 0);
    }
}
