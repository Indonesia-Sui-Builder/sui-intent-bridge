// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {CoreBridgeVM} from "wormhole-solidity-sdk/interfaces/ICoreBridge.sol";

contract MockWormhole {
    uint32 public currentGuardianSetIndex = 0;

    function parseAndVerifyVM(
        bytes calldata encodedVM
    )
        external
        view
        returns (CoreBridgeVM memory vm, bool valid, string memory reason)
    {
        // Return a valid VM with data parsed from the hex
        // We assume the input is exactly valid for our logic
        // Simplified parsing for mock: just return success and mock execution

        vm.version = 1;
        vm.timestamp = uint32(block.timestamp);
        vm.nonce = 0;
        vm.emitterChainId = 21; // Sui
        vm
            .emitterAddress = 0xf6a696471cc053ede2007c1624405f7b0aa8e860f780589e358776e0b88ce2f1; // Hardcoded or extracted
        vm.sequence = 3;
        vm.consistencyLevel = 0;
        vm.guardianSetIndex = 0;
        vm.hash = keccak256(encodedVM);

        // Extract Payload based on length
        // VAA usually: Header (6 bytes) + SigCount (1) + Sigs (66 * n) + Body
        // Body: Timestamp(4) + Nonce(4) + EmitterChain(2) + EmitterAddr(32) + Seq(8) + Consistency(1) + Payload(N)

        // For this mock, we will just return the payload we KNOW is sent (Order 0 + Solver)
        // Or we can try to actually slice the calldata if we want to be generic.
        // But for the specific test case:

        // 32 bytes of zeros (Order 0) + 32 bytes of Solver Address
        // Solver: 0xffed326eb5d14d91fd492f9793c4c31c127a00c868a6418786394fbfd61cdfcd

        // To allow the script to pass ANY data, let's just claim it's valid.
        // But we need the payload to allow `abi.decode` in IntentVault to work.
        // We will construct the payload manually here to match what the script sends or what IntentVault expects.
        // Actually, IntentVault calls this *before* decoding.

        // Wait, parseAndVerifyVM returns the VM struct which contains the PAYLOAD.
        // If I return a specific payload here, IntentVault uses THAT.
        // It ignores the raw bytes passed in (except hash checking).

        // We need to return the payload that matches the VAA we generated from Sui.
        // VAA Payload:
        // OrderID (32 bytes) + Solver (32 bytes).

        bytes memory payload = abi.encodePacked(
            uint256(0), // Order ID 0
            bytes32(
                0xffed326eb5d14d91fd492f9793c4c31c127a00c868a6418786394fbfd61cdfcd
            ) // Solver (from log)
        );
        vm.payload = payload;

        valid = true;
        reason = "";
    }

    function getCurrentGuardianSetIndex() external view returns (uint32) {
        return currentGuardianSetIndex;
    }
}
