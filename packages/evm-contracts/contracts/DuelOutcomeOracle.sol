// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract DuelOutcomeOracle is AccessControl {
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 public constant FINALIZER_ROLE = keccak256("FINALIZER_ROLE");
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    error InvalidAdmin();
    error InvalidReporter();
    error InvalidFinalizer();
    error InvalidChallenger();
    error InvalidPauser();
    error InvalidDuelKey();
    error InvalidParticipant();
    error DuplicateParticipants();
    error InvalidStatus();
    error InvalidBettingWindow();
    error InvalidDuelStart();
    error InvalidTransition();
    error DuelMissing();
    error InvalidWinner();
    error InvalidDuelEnd();
    error DuelAlreadyResolved();
    error DuelAlreadyCancelled();
    error ProposalMissing();
    error ProposalExists();
    error NotProposed();
    error AlreadyChallenged();
    error DisputeWindowActive();
    error InvalidDisputeWindow();
    error DuelNotLocked();
    error BettingWindowActive();
    error ChallengeWindowExpired();
    error OraclePaused();
    error GovernanceSurfaceFrozen();
    error NotChallenged();
    error ParticipantHashImmutable();
    error TimingImmutable();

    enum DuelStatus {
        NULL,
        SCHEDULED,
        BETTING_OPEN,
        LOCKED,
        PROPOSED,
        CHALLENGED,
        RESOLVED,
        CANCELLED
    }

    enum Side {
        NONE,
        A,
        B
    }

    struct ResultProposal {
        bytes32 id;
        bytes32 resultHash;
        bytes32 replayHash;
        Side winner;
        uint64 seed;
        uint64 duelEndTs;
        uint64 proposedAt;
        bool challenged;
        bool exists;
    }

    struct DuelState {
        bytes32 duelKey;
        bytes32 participantAHash;
        bytes32 participantBHash;
        DuelStatus status;
        Side winner;
        uint64 betOpenTs;
        uint64 betCloseTs;
        uint64 duelStartTs;
        uint64 duelEndTs;
        uint64 seed;
        bytes32 resultHash;
        bytes32 replayHash;
        bytes32 activeProposalId;
        string metadataUri;
    }

    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint64 public immutable disputeWindowSeconds;
    bool public oracleActionsPaused;

    mapping(bytes32 => DuelState) private duels;
    mapping(bytes32 => ResultProposal) public proposals;

    event DuelUpserted(
        bytes32 indexed duelKey,
        DuelStatus status,
        uint64 betOpenTs,
        uint64 betCloseTs,
        uint64 duelStartTs,
        string metadataUri
    );
    event DuelCancelled(bytes32 indexed duelKey, string metadataUri);
    event ResultProposed(
        bytes32 indexed duelKey,
        bytes32 indexed proposalId,
        Side winner,
        uint64 seed,
        uint64 duelEndTs,
        bytes32 resultHash,
        bytes32 replayHash,
        string metadataUri
    );
    event ResultChallenged(bytes32 indexed duelKey, bytes32 indexed proposalId, string metadataUri);
    event DuelResolved(
        bytes32 indexed duelKey,
        bytes32 indexed proposalId,
        Side winner,
        uint64 seed,
        uint64 duelEndTs,
        bytes32 resultHash,
        bytes32 replayHash,
        string metadataUri
    );
    event PauserUpdated(address indexed pauser, bool enabled);
    event OraclePauseUpdated(bool paused, address indexed actor);

    constructor(
        address admin,
        address reporter,
        address finalizer,
        address challenger,
        address pauser,
        uint64 disputeWindowSeconds_
    ) {
        if (admin == address(0)) revert InvalidAdmin();
        if (reporter == address(0)) revert InvalidReporter();
        if (finalizer == address(0)) revert InvalidFinalizer();
        if (challenger == address(0)) revert InvalidChallenger();
        if (pauser == address(0)) revert InvalidPauser();
        if (disputeWindowSeconds_ < 60) revert InvalidDisputeWindow();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REPORTER_ROLE, reporter);
        _grantRole(FINALIZER_ROLE, finalizer);
        _grantRole(CHALLENGER_ROLE, challenger);
        _grantRole(PAUSER_ROLE, pauser);
        disputeWindowSeconds = disputeWindowSeconds_;
    }

    function setReporter(address /* reporter */, bool /* enabled */)
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        revert GovernanceSurfaceFrozen();
    }

    function setFinalizer(address /* finalizer */, bool /* enabled */)
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        revert GovernanceSurfaceFrozen();
    }

    function setChallenger(address /* challenger */, bool /* enabled */)
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        revert GovernanceSurfaceFrozen();
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

    function setOraclePaused(bool paused) external onlyRole(PAUSER_ROLE) {
        oracleActionsPaused = paused;
        emit OraclePauseUpdated(paused, msg.sender);
    }

    function getDuel(bytes32 duelKey) external view returns (DuelState memory) {
        return duels[duelKey];
    }

    function proposalId(bytes32 duelKey, bytes32 resultHash, bytes32 replayHash) public pure returns (bytes32) {
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encode(duelKey, resultHash, replayHash));
    }

    function upsertDuel(
        bytes32 duelKey,
        bytes32 participantAHash,
        bytes32 participantBHash,
        uint64 betOpenTs,
        uint64 betCloseTs,
        uint64 duelStartTs,
        string calldata metadataUri,
        DuelStatus status
    ) external onlyRole(REPORTER_ROLE) {
        if (oracleActionsPaused) revert OraclePaused();
        if (duelKey == bytes32(0)) revert InvalidDuelKey();
        if (participantAHash == bytes32(0)) revert InvalidParticipant();
        if (participantBHash == bytes32(0)) revert InvalidParticipant();
        if (participantAHash == participantBHash) revert DuplicateParticipants();
        if (
            status != DuelStatus.SCHEDULED
                && status != DuelStatus.BETTING_OPEN
                && status != DuelStatus.LOCKED
        ) revert InvalidStatus();
        if (betOpenTs == 0 || betCloseTs <= betOpenTs) revert InvalidBettingWindow();
        if (duelStartTs < betCloseTs) revert InvalidDuelStart();
        if (status == DuelStatus.LOCKED && block.timestamp < betCloseTs) revert BettingWindowActive();

        DuelState storage duel = duels[duelKey];
        _requireSettleable(duel);
        if (uint8(status) < uint8(duel.status)) revert InvalidTransition();

        // FIX-4: Lock participant identity and bet timing once betting opens
        if (duel.status >= DuelStatus.BETTING_OPEN) {
            if (participantAHash != duel.participantAHash) revert ParticipantHashImmutable();
            if (participantBHash != duel.participantBHash) revert ParticipantHashImmutable();
            if (betOpenTs != duel.betOpenTs) revert TimingImmutable();
            if (betCloseTs != duel.betCloseTs) revert TimingImmutable();
        }

        duel.duelKey = duelKey;
        duel.participantAHash = participantAHash;
        duel.participantBHash = participantBHash;
        duel.status = status;
        duel.betOpenTs = betOpenTs;
        duel.betCloseTs = betCloseTs;
        duel.duelStartTs = duelStartTs;
        duel.metadataUri = metadataUri;

        emit DuelUpserted(duelKey, status, betOpenTs, betCloseTs, duelStartTs, metadataUri);
    }

    function cancelDuel(bytes32 duelKey, string calldata metadataUri) external onlyRole(PAUSER_ROLE) {
        if (oracleActionsPaused) revert OraclePaused();
        DuelState storage duel = duels[duelKey];
        if (duel.status == DuelStatus.NULL) revert DuelMissing();
        _requireSettleable(duel);
        duel.status = DuelStatus.CANCELLED;
        duel.activeProposalId = bytes32(0);
        duel.metadataUri = metadataUri;
        emit DuelCancelled(duelKey, metadataUri);
    }

    function proposeResult(
        bytes32 duelKey,
        Side winner,
        uint64 seed,
        bytes32 replayHash,
        bytes32 resultHash,
        uint64 duelEndTs,
        string calldata metadataUri
    ) external onlyRole(REPORTER_ROLE) returns (bytes32 id) {
        if (oracleActionsPaused) revert OraclePaused();
        DuelState storage duel = duels[duelKey];
        if (duel.status == DuelStatus.NULL) revert DuelMissing();
        _requireSettleable(duel);
        if (duel.status != DuelStatus.LOCKED) revert DuelNotLocked();
        if (block.timestamp < duel.betCloseTs) revert BettingWindowActive();
        if (winner != Side.A && winner != Side.B) revert InvalidWinner();
        if (duelEndTs < duel.betCloseTs) revert InvalidDuelEnd();

        id = proposalId(duelKey, resultHash, replayHash);
        if (proposals[id].exists) revert ProposalExists();

        proposals[id] = ResultProposal({
            id: id,
            resultHash: resultHash,
            replayHash: replayHash,
            winner: winner,
            seed: seed,
            duelEndTs: duelEndTs,
            proposedAt: uint64(block.timestamp),
            challenged: false,
            exists: true
        });

        duel.status = DuelStatus.PROPOSED;
        duel.activeProposalId = id;
        duel.metadataUri = metadataUri;

        emit ResultProposed(duelKey, id, winner, seed, duelEndTs, resultHash, replayHash, metadataUri);
    }

    function challengeResult(bytes32 duelKey, string calldata metadataUri) external onlyRole(CHALLENGER_ROLE) {
        if (oracleActionsPaused) revert OraclePaused();
        DuelState storage duel = duels[duelKey];
        if (duel.status != DuelStatus.PROPOSED) revert NotProposed();
        bytes32 id = duel.activeProposalId;
        ResultProposal storage proposal = proposals[id];
        if (!proposal.exists) revert ProposalMissing();
        if (proposal.challenged) revert AlreadyChallenged();
        if (block.timestamp >= proposal.proposedAt + disputeWindowSeconds) revert ChallengeWindowExpired();

        proposal.challenged = true;
        duel.status = DuelStatus.CHALLENGED;
        duel.metadataUri = metadataUri;
        emit ResultChallenged(duelKey, id, metadataUri);
    }

    // FIX-3: Resolution path for challenged duels — allows reporter to submit a new proposal
    function reproposeResult(
        bytes32 duelKey,
        Side winner,
        uint64 seed,
        bytes32 replayHash,
        bytes32 resultHash,
        uint64 duelEndTs,
        string calldata metadataUri
    ) external onlyRole(REPORTER_ROLE) returns (bytes32 id) {
        if (oracleActionsPaused) revert OraclePaused();
        DuelState storage duel = duels[duelKey];
        _requireSettleable(duel);
        if (duel.status != DuelStatus.CHALLENGED) revert NotChallenged();
        if (winner != Side.A && winner != Side.B) revert InvalidWinner();
        if (duelEndTs < duel.betCloseTs) revert InvalidDuelEnd();

        delete proposals[duel.activeProposalId];

        id = proposalId(duelKey, resultHash, replayHash);
        if (proposals[id].exists) revert ProposalExists();

        proposals[id] = ResultProposal({
            id: id,
            resultHash: resultHash,
            replayHash: replayHash,
            winner: winner,
            seed: seed,
            duelEndTs: duelEndTs,
            proposedAt: uint64(block.timestamp),
            challenged: false,
            exists: true
        });

        duel.status = DuelStatus.PROPOSED;
        duel.activeProposalId = id;
        duel.metadataUri = metadataUri;

        emit ResultProposed(duelKey, id, winner, seed, duelEndTs, resultHash, replayHash, metadataUri);
    }

    function finalizeResult(bytes32 duelKey, string calldata metadataUri) external onlyRole(FINALIZER_ROLE) {
        if (oracleActionsPaused) revert OraclePaused();
        DuelState storage duel = duels[duelKey];
        if (duel.status != DuelStatus.PROPOSED) revert NotProposed();

        ResultProposal storage proposal = proposals[duel.activeProposalId];
        if (!proposal.exists) revert ProposalMissing();
        if (proposal.challenged) revert AlreadyChallenged();
        if (block.timestamp < proposal.proposedAt + disputeWindowSeconds) revert DisputeWindowActive();

        duel.status = DuelStatus.RESOLVED;
        duel.winner = proposal.winner;
        duel.seed = proposal.seed;
        duel.replayHash = proposal.replayHash;
        duel.resultHash = proposal.resultHash;
        duel.duelEndTs = proposal.duelEndTs;
        duel.metadataUri = metadataUri;

        emit DuelResolved(
            duelKey,
            proposal.id,
            proposal.winner,
            proposal.seed,
            proposal.duelEndTs,
            proposal.resultHash,
            proposal.replayHash,
            metadataUri
        );
    }

    function _requireSettleable(DuelState storage duel) private view {
        if (duel.status == DuelStatus.RESOLVED) revert DuelAlreadyResolved();
        if (duel.status == DuelStatus.CANCELLED) revert DuelAlreadyCancelled();
    }
}
