// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

enum ConsensusType {
    Majority,
    Threshold
}

enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

/// @notice Requests BTC prices and UP/DOWN trading decisions from Somnia Agents.
contract AgentCallbackV2 {
    /// @notice SomniaAgents platform configured when this contract is deployed.
    IAgentRequester public immutable platform;

    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant LLM_INFERENCE_AGENT_ID = 12847293847561029384;

    /// @notice State for the latest JSON API price request.
    uint256 public lastRequestId;
    ResponseStatus public lastStatus;
    bytes public lastResult;

    /// @notice State for the latest LLM decision response.
    string public lastDecision;
    ResponseStatus public lastDecisionStatus;

    event RequestSent(uint256 requestId);
    event ResponseReceived(
        uint256 requestId,
        ResponseStatus status,
        bytes result
    );
    event DecisionRequestSent(uint256 requestId);
    event DecisionReceived(
        uint256 requestId,
        ResponseStatus status,
        string decision
    );

    constructor(address platformAddress) {
        require(platformAddress != address(0), "Invalid platform address");
        platform = IAgentRequester(platformAddress);
    }

    /// @notice Requests BTC/USD with eight decimal places from CoinGecko.
    /// @dev The caller must attach enough STT to fund the Somnia agent request.
    function requestBtcPrice() external payable returns (uint256 requestId) {
        bytes4 fetchUintSelector = bytes4(
            keccak256("fetchUint(string,string,uint8)")
        );

        bytes memory payload = abi.encodeWithSelector(
            fetchUintSelector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );

        requestId = platform.createRequest{value: msg.value}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        lastRequestId = requestId;
        emit RequestSent(requestId);
    }

    /// @notice Receives and stores the first successful JSON API response.
    function handleResponse(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata request
    ) external {
        require(msg.sender == address(platform), "Only platform");

        // The complete request is part of the platform callback ABI. The
        // response array already contains the value needed by this receiver.
        request;

        lastRequestId = requestId;
        lastStatus = status;
        delete lastResult;

        for (uint256 i = 0; i < responses.length; ++i) {
            if (responses[i].status == ResponseStatus.Success) {
                lastResult = responses[i].result;
                break;
            }
        }

        emit ResponseReceived(requestId, status, lastResult);
    }

    /// @notice Requests an UP/DOWN trading decision from the LLM agent.
    /// @param btcPriceUsd8Decimals BTC/USD expressed with eight decimals.
    /// @dev The caller must attach enough STT to fund the Somnia agent request.
    function requestTradingDecision(
        uint256 btcPriceUsd8Decimals
    ) external payable returns (uint256 requestId) {
        string memory formattedPrice = _formatUsd8(btcPriceUsd8Decimals);
        string memory prompt = string.concat(
            "Current BTC price is $",
            formattedPrice,
            ". Based on this price alone, should a trader go UP or DOWN on a short-term binary prediction market? Respond with exactly one word."
        );

        string[] memory allowedValues = new string[](2);
        allowedValues[0] = "UP";
        allowedValues[1] = "DOWN";

        bytes4 inferStringSelector = bytes4(
            keccak256("inferString(string,string,bool,string[])")
        );

        bytes memory payload = abi.encodeWithSelector(
            inferStringSelector,
            prompt,
            "You are a concise crypto trading signal generator. Always respond with exactly one word: UP or DOWN.",
            false,
            allowedValues
        );

        requestId = platform.createRequest{value: msg.value}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleLlmResponse.selector,
            payload
        );

        emit DecisionRequestSent(requestId);
    }

    /// @notice Receives and decodes the first successful ABI-encoded string.
    function handleLlmResponse(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata request
    ) external {
        require(msg.sender == address(platform), "Only platform");

        request;
        lastDecisionStatus = status;
        delete lastDecision;

        for (uint256 i = 0; i < responses.length; ++i) {
            if (responses[i].status == ResponseStatus.Success) {
                lastDecision = abi.decode(responses[i].result, (string));
                break;
            }
        }

        emit DecisionReceived(requestId, status, lastDecision);
    }

    /// @notice Decodes the latest JSON API result as uint256.
    function getLastPriceAsUint() external view returns (uint256) {
        require(lastResult.length >= 32, "No valid price result");
        return abi.decode(lastResult, (uint256));
    }

    /// @notice Returns the latest decoded LLM decision.
    function getLastDecision() external view returns (string memory) {
        return lastDecision;
    }

    /// @dev Formats an integer carrying eight decimals as a decimal USD string.
    function _formatUsd8(uint256 value) internal pure returns (string memory) {
        uint256 whole = value / 1e8;
        uint256 fraction = value % 1e8;
        string memory fractionText = _toString(fraction);
        bytes memory paddedFraction = new bytes(8);
        uint256 padding = 8 - bytes(fractionText).length;

        for (uint256 i = 0; i < padding; ++i) {
            paddedFraction[i] = bytes1("0");
        }
        for (uint256 i = 0; i < bytes(fractionText).length; ++i) {
            paddedFraction[padding + i] = bytes(fractionText)[i];
        }

        return string.concat(_toString(whole), ".", string(paddedFraction));
    }

    /// @dev Minimal uint256-to-decimal-string conversion.
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }

        uint256 digits;
        uint256 remaining = value;
        while (remaining != 0) {
            ++digits;
            remaining /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            --digits;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /// @notice Accepts Somnia platform rebates and native STT transfers.
    receive() external payable {}
}
