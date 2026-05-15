// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Escrow {

    address public payer;
    address public payee;
    uint public amount;
    bool public delivered;

    constructor(address _payee) payable {
        payer = msg.sender;
        payee = _payee;
        amount = msg.value;
    }

    function confirmDelivery() public {
        require(msg.sender == payer, "Only payer can confirm");

        delivered = true;

        payable(payee).transfer(amount);
    }
}
