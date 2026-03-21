// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract SkillOracle is AccessControl {
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant Z_SCORE = 3;
    uint256 public constant K_FACTOR = 500;
    uint256 public constant MAX_MU_DELTA = 500;
    uint256 public constant MAX_SIGMA_DELTA = 300;

    error InvalidAdmin();
    error InvalidReporter();
    error InvalidPauser();
    error GovernanceSurfaceFrozen();
    error UnauthorizedReporter();
    error OraclePaused();
    error StaleOracle();
    error MuDeltaExceeded();
    error SigmaDeltaExceeded();

    struct AgentSkill {
        uint256 mu;
        uint256 sigma;
        uint256 lastUpdate;
    }

    mapping(bytes32 => AgentSkill) public agentSkills;
    bytes32[] public activeAgents;

    uint256 public globalMeanMu;
    uint256 private totalMu;
    uint256 public immutable basePrice;
    uint256 public immutable maxOracleDelay;
    bool public oraclePaused;

    event SkillUpdated(bytes32 indexed agentId, uint256 mu, uint256 sigma);
    event AgentRemoved(bytes32 indexed agentId);
    event OraclePauseUpdated(bool paused, address indexed actor);
    event PauserUpdated(address indexed pauser, bool enabled);
    event MaxOracleDelayUpdated(uint256 newMaxOracleDelay);

    constructor(
        uint256 initialBasePrice,
        uint256 maxOracleDelay_,
        address admin,
        address reporter,
        address pauser
    ) {
        require(initialBasePrice > 0, "Invalid base price");
        if (admin == address(0)) revert InvalidAdmin();
        if (reporter == address(0)) revert InvalidReporter();
        if (pauser == address(0)) revert InvalidPauser();

        basePrice = initialBasePrice;
        maxOracleDelay = maxOracleDelay_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REPORTER_ROLE, reporter);
        _grantRole(PAUSER_ROLE, pauser);
    }

    // ── PM20 governance freeze: block inherited AccessControl role mutations ──

    function grantRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (role != PAUSER_ROLE) revert GovernanceSurfaceFrozen();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (role != PAUSER_ROLE) revert GovernanceSurfaceFrozen();
        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) public override {
        if (role != PAUSER_ROLE) revert GovernanceSurfaceFrozen();
        super.renounceRole(role, callerConfirmation);
    }

    function setPauser(address pauser, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pauser == address(0)) revert InvalidPauser();
        if (enabled) {
            _grantRole(PAUSER_ROLE, pauser);
        } else {
            _revokeRole(PAUSER_ROLE, pauser);
        }
        emit PauserUpdated(pauser, enabled);
    }

    function setOraclePaused(bool paused) external onlyRole(PAUSER_ROLE) {
        oraclePaused = paused;
        emit OraclePauseUpdated(paused, msg.sender);
    }

    function setMaxOracleDelay(uint256 newMaxOracleDelay) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        // Frozen post-bootstrap — config changes require redeployment
        revert GovernanceSurfaceFrozen();
    }

    function updateAgentSkill(bytes32 agentId, uint256 mu, uint256 sigma) external onlyRole(REPORTER_ROLE) {
        if (oraclePaused) revert OraclePaused();

        AgentSkill storage existing = agentSkills[agentId];
        if (existing.lastUpdate == 0) {
            activeAgents.push(agentId);
            totalMu += mu;
        } else {
            uint256 muDelta = mu > existing.mu ? mu - existing.mu : existing.mu - mu;
            uint256 sigmaDelta = sigma > existing.sigma ? sigma - existing.sigma : existing.sigma - sigma;
            if (muDelta > MAX_MU_DELTA) revert MuDeltaExceeded();
            if (sigmaDelta > MAX_SIGMA_DELTA) revert SigmaDeltaExceeded();

            totalMu = totalMu - existing.mu + mu;
        }
        agentSkills[agentId] = AgentSkill(mu, sigma, block.timestamp);
        globalMeanMu = totalMu / activeAgents.length;
        emit SkillUpdated(agentId, mu, sigma);
    }

    function removeAgent(bytes32 agentId) external onlyRole(REPORTER_ROLE) {
        AgentSkill storage skill = agentSkills[agentId];
        require(skill.lastUpdate != 0, "Agent not found");
        totalMu -= skill.mu;
        delete agentSkills[agentId];
        // Swap-and-pop from activeAgents array
        for (uint256 i = 0; i < activeAgents.length; i++) {
            if (activeAgents[i] == agentId) {
                activeAgents[i] = activeAgents[activeAgents.length - 1];
                activeAgents.pop();
                break;
            }
        }
        if (activeAgents.length > 0) {
            globalMeanMu = totalMu / activeAgents.length;
        } else {
            globalMeanMu = 0;
        }
        emit AgentRemoved(agentId);
    }

    function getConservativeSkill(bytes32 agentId) public view returns (int256) {
        require(agentSkills[agentId].lastUpdate != 0, "Agent not found");
        AgentSkill memory skill = agentSkills[agentId];
        return int256(skill.mu) - int256(Z_SCORE * skill.sigma);
    }

    function getIndexPrice(bytes32 agentId) public view returns (uint256) {
        AgentSkill memory skill = agentSkills[agentId];
        require(skill.lastUpdate != 0, "Agent not found");
        if (maxOracleDelay > 0 && block.timestamp - skill.lastUpdate > maxOracleDelay) {
            revert StaleOracle();
        }

        int256 diff = getConservativeSkill(agentId) - int256(globalMeanMu);
        int256 xScaled = (diff * 1e18) / int256(K_FACTOR);

        if (xScaled >= 0) {
            return (basePrice * (1e18 + uint256(xScaled))) / 1e18;
        }

        uint256 absX = uint256(-xScaled);
        if (absX >= 1e18) {
            return basePrice / 100;
        }
        return (basePrice * (1e18 - absX)) / 1e18;
    }

    function activeAgentCount() external view returns (uint256) {
        return activeAgents.length;
    }
}
