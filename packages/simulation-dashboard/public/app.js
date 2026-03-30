/* ─── Hyperbet Simulation Dashboard ─ Client JS ────────────────────────────── */
(function () {
    "use strict";

    const WS_URL = "ws://localhost:3400";
    let ws = null;
    let state = null;
    const tapeEntries = [];
    const MAX_TAPE = 500;

    // ─── DOM refs ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const connBadge = $("connection-badge");
    const tickCounter = $("tick-counter");
    const oracleAddr = $("oracle-addr");
    const clobAddr = $("clob-addr");
    const duelLabel = $("duel-label");
    const marketStatus = $("market-status");
    const bestBid = $("best-bid");
    const bestAsk = $("best-ask");
    const totalA = $("total-a");
    const totalB = $("total-b");
    const feeTreasury = $("fee-treasury");
    const feeMm = $("fee-mm");
    const profitTreasury = $("profit-treasury");
    const profitMm = $("profit-mm");
    const spreadValue = $("spread-value");
    const bidsContainer = $("bids-container");
    const asksContainer = $("asks-container");
    const eventTape = $("event-tape");
    const eventCount = $("event-count");
    const agentsGrid = $("agents-grid");
    const scenarioSelect = $("scenario-select");
    const speedSlider = $("speed-slider");
    const speedValueEl = $("speed-value");
    const depthSvg = $("depth-svg");
    const visContainer = $("visualizer-container");

    // ─── Visualizer State ────────────────────────────────────────────────────
    let simStarted = false;
    let visSvg, visSimulation, visNodes = [], visLinks = [];
    let nodeElements, linkElements;
    const coreNodes = {
        clob: { id: "CLOB", group: "core", radius: 40, label: "GoldClob\nMatching Engine", color: "#38bdf8" },
        oracle: { id: "ORACLE", group: "core", radius: 30, label: "DuelOutcome\nOracle", color: "#818cf8" }
    };

    // ─── WebSocket ───────────────────────────────────────────────────────────
    function connect() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            connBadge.textContent = "Connected";
            connBadge.className = "badge badge-connected";
            send({ command: "get_state" });
            send({ command: "get_events" });
        };

        ws.onclose = () => {
            connBadge.textContent = "Disconnected";
            connBadge.className = "badge badge-disconnected";
            setTimeout(connect, 2000);
        };

        ws.onerror = () => { };

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                handleMessage(msg);
            } catch { /* ignore */ }
        };
    }

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    // ─── Message Handler ────────────────────────────────────────────────────
    function handleMessage(msg) {
        switch (msg.type) {
            case "state":
                if (!simStarted) {
                    initVisualizer();
                    simStarted = true;
                }
                state = msg.data;
                renderState();
                updateVisualizer(state);
                break;
            case "event":
                addTapeEntry(formatEvent(msg.data));
                triggerInteractionEvent(msg.data);
                break;
            case "log":
                addTapeEntry(formatLog(msg.data));
                break;
            case "events_bulk":
                for (const ev of msg.data) {
                    addTapeEntry(formatEvent(ev), true);
                }
                break;
            case "duel_opened":
                addTapeEntry({
                    html: `<span class="tape-time">—</span><span>🎲 New duel opened: <strong>${msg.data.label}</strong></span>`,
                    cls: "event-MarketCreated",
                });
                break;
        }
    }

    // ─── Render State ───────────────────────────────────────────────────────
    function renderState() {
        if (!state) return;

        tickCounter.textContent = `Tick #${state.tick}`;

        // Contract info
        if (state.contracts) {
            oracleAddr.textContent = shortAddr(state.contracts.oracle);
            oracleAddr.title = state.contracts.oracle;
            clobAddr.textContent = shortAddr(state.contracts.clob);
            clobAddr.title = state.contracts.clob;
        }

        if (state.duel) {
            duelLabel.textContent = state.duel.label;
        }

        if (state.market) {
            const statusNames = ["NULL", "OPEN", "LOCKED", "RESOLVED", "CANCELLED"];
            const statusClasses = ["", "badge-open", "badge-locked", "badge-resolved", "badge-cancelled"];
            const s = state.market.status;
            marketStatus.textContent = statusNames[s] || "—";
            marketStatus.className = `badge ${statusClasses[s] || ""}`;

            bestBid.textContent = state.market.bestBid > 0 ? state.market.bestBid : "—";
            bestAsk.textContent = state.market.bestAsk > 0 && state.market.bestAsk < 1000 ? state.market.bestAsk : "—";
            totalA.textContent = formatBigNumber(state.market.totalAShares);
            totalB.textContent = formatBigNumber(state.market.totalBShares);

            const bid = state.market.bestBid;
            const ask = state.market.bestAsk;
            if (bid > 0 && ask > 0 && ask < 1000) {
                spreadValue.textContent = `${ask - bid} (${((ask - bid) / ((bid + ask) / 2) * 100).toFixed(1)}%)`;
            } else {
                spreadValue.textContent = "—";
            }
        }

        if (state.fees) {
            feeTreasury.textContent = `${state.fees.treasuryBps} bps`;
            feeMm.textContent = `${state.fees.mmBps} bps`;

            const displaySymbol = state.fees.displaySymbol || "ETH";
            const displayDecimals = Number(state.fees.displayDecimals ?? 18);
            const accrualUnit = state.fees.accrualUnit || "wei";

            if (profitTreasury) {
                profitTreasury.textContent = formatAtomicAmount(
                    state.fees.treasuryAccruedAtomic || state.fees.treasuryAccruedWei,
                    displayDecimals,
                    displaySymbol,
                    accrualUnit,
                );
            }
            if (profitMm) {
                profitMm.textContent = formatAtomicAmount(
                    state.fees.mmAccruedAtomic || state.fees.mmAccruedWei,
                    displayDecimals,
                    displaySymbol,
                    accrualUnit,
                );
            }
        }

        // Order book
        renderBook(state.book);
        renderDepthChart(state.book);

        // Agents
        renderAgents(state.agents);

        // Scenarios
        if (state.scenarios && scenarioSelect.children.length <= 1) {
            for (const sc of state.scenarios) {
                const opt = document.createElement("option");
                opt.value = sc.name;
                opt.textContent = `${sc.name} — ${sc.description}`;
                scenarioSelect.appendChild(opt);
            }
        }
    }

    // ─── Order Book ─────────────────────────────────────────────────────────
    function renderBook(book) {
        if (!book) return;

        bidsContainer.innerHTML = "";
        asksContainer.innerHTML = "";

        const bids = book.bids || [];
        const asks = book.asks || [];
        const maxTotal = Math.max(
            ...bids.map((b) => Number(b.total)),
            ...asks.map((a) => Number(a.total)),
            1,
        );

        // Bids (highest first)
        const sortedBids = [...bids].sort((a, b) => b.price - a.price);
        for (const level of sortedBids) {
            const pct = (Number(level.total) / maxTotal) * 100;
            const el = document.createElement("div");
            el.className = "book-level bid";
            el.innerHTML = `<span class="bid-color">${level.price}</span><span>${formatBigNumber(level.total)}</span>`;
            el.style.setProperty("--bar-width", `${pct}%`);
            el.querySelector("::before")
            el.style.cssText += `; --bar-width: ${pct}%`;
            // Set the width via the ::before pseudo-element
            const style = document.createElement("style");
            style.textContent = `#bids-container .book-level:nth-child(${sortedBids.indexOf(level) + 1})::before { width: ${pct}%; }`;
            bidsContainer.appendChild(style);
            bidsContainer.appendChild(el);
        }

        // Asks (lowest first)
        const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
        for (const level of sortedAsks) {
            const pct = (Number(level.total) / maxTotal) * 100;
            const el = document.createElement("div");
            el.className = "book-level ask";
            el.innerHTML = `<span class="ask-color">${level.price}</span><span>${formatBigNumber(level.total)}</span>`;
            const style = document.createElement("style");
            style.textContent = `#asks-container .book-level:nth-child(${sortedAsks.indexOf(level) + 1})::before { width: ${pct}%; }`;
            asksContainer.appendChild(style);
            asksContainer.appendChild(el);
        }

        if (bids.length === 0) {
            bidsContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 0.75rem;">No bids</div>';
        }
        if (asks.length === 0) {
            asksContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 0.75rem;">No asks</div>';
        }
    }

    // ─── Depth Chart SVG ────────────────────────────────────────────────────
    function renderDepthChart(book) {
        if (!book) return;

        const bids = [...(book.bids || [])].sort((a, b) => b.price - a.price);
        const asks = [...(book.asks || [])].sort((a, b) => a.price - b.price);

        const svg = depthSvg;
        const w = svg.clientWidth || 600;
        const h = 160;
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

        let html = "";

        if (bids.length === 0 && asks.length === 0) {
            html = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#64748b" font-size="12" font-family="Inter">No orders yet — start a simulation</text>`;
            svg.innerHTML = html;
            return;
        }

        // Find price range
        const allPrices = [...bids.map((b) => b.price), ...asks.map((a) => a.price)];
        const minPrice = Math.max(1, Math.min(...allPrices) - 30);
        const maxPrice = Math.min(999, Math.max(...allPrices) + 30);
        const priceRange = maxPrice - minPrice || 1;

        // Cumulative depth
        let bidCumulative = [];
        let cumSum = 0;
        for (const b of bids) {
            cumSum += Number(b.total);
            bidCumulative.push({ price: b.price, cum: cumSum });
        }

        let askCumulative = [];
        cumSum = 0;
        for (const a of asks) {
            cumSum += Number(a.total);
            askCumulative.push({ price: a.price, cum: cumSum });
        }

        const maxCum = Math.max(
            ...bidCumulative.map((b) => b.cum),
            ...askCumulative.map((a) => a.cum),
            1,
        );

        const px = (price) => ((price - minPrice) / priceRange) * w;
        const py = (cum) => h - (cum / maxCum) * (h - 20);

        // Bid area (filled)
        if (bidCumulative.length > 0) {
            let pathD = `M ${px(bidCumulative[0].price)} ${py(bidCumulative[0].cum)}`;
            for (let i = 1; i < bidCumulative.length; i++) {
                pathD += ` L ${px(bidCumulative[i].price)} ${py(bidCumulative[i].cum)}`;
            }
            const lastBid = bidCumulative[bidCumulative.length - 1];
            pathD += ` L ${px(lastBid.price)} ${h} L ${px(bidCumulative[0].price)} ${h} Z`;
            html += `<path d="${pathD}" fill="rgba(34, 211, 238, 0.15)" stroke="#22d3ee" stroke-width="1.5"/>`;
        }

        // Ask area (filled)
        if (askCumulative.length > 0) {
            let pathD = `M ${px(askCumulative[0].price)} ${py(askCumulative[0].cum)}`;
            for (let i = 1; i < askCumulative.length; i++) {
                pathD += ` L ${px(askCumulative[i].price)} ${py(askCumulative[i].cum)}`;
            }
            const lastAsk = askCumulative[askCumulative.length - 1];
            pathD += ` L ${px(lastAsk.price)} ${h} L ${px(askCumulative[0].price)} ${h} Z`;
            html += `<path d="${pathD}" fill="rgba(244, 114, 182, 0.15)" stroke="#f472b6" stroke-width="1.5"/>`;
        }

        // Mid line
        if (state && state.market) {
            const mid = (state.market.bestBid + state.market.bestAsk) / 2;
            if (mid > 0 && mid < 1000) {
                const mx = px(mid);
                html += `<line x1="${mx}" y1="0" x2="${mx}" y2="${h}" stroke="#fbbf24" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`;
                html += `<text x="${mx}" y="12" text-anchor="middle" fill="#fbbf24" font-size="10" font-family="Inter" opacity="0.8">Mid ${Math.round(mid)}</text>`;
            }
        }

        // Price axis
        const step = Math.max(10, Math.round(priceRange / 8 / 10) * 10);
        for (let p = Math.ceil(minPrice / step) * step; p <= maxPrice; p += step) {
            const x = px(p);
            html += `<text x="${x}" y="${h - 2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Inter">${p}</text>`;
            html += `<line x1="${x}" y1="0" x2="${x}" y2="${h - 14}" stroke="#1e293b" stroke-width="0.5"/>`;
        }

        svg.innerHTML = html;
    }

    // ─── Agent Cards ────────────────────────────────────────────────────────
    function renderAgents(agents) {
        if (!agents) return;

        agentsGrid.innerHTML = "";
        const currencySymbol =
            state?.fees?.displaySymbol || (state?.backend === "solana" ? "SOL" : "ETH");
        for (const agent of agents) {
            const card = document.createElement("div");
            card.className = `agent-card ${agent.enabled ? "" : "disabled"}`;
            card.style.setProperty("--agent-color", agent.color);
            card.innerHTML = `
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ${agent.color}; border-radius: 10px 10px 0 0;"></div>
        <button class="agent-toggle ${agent.enabled ? "active" : ""}" data-strategy="${agent.strategy}" title="Toggle agent"></button>
        <div class="agent-header">
          <span class="agent-name" style="color: ${agent.color}">${agent.name}</span>
          <span class="agent-strategy">${agent.strategy}</span>
        </div>
        <div class="agent-desc">${agent.description}</div>
        <div class="agent-stats">
          <div class="agent-stat"><span class="agent-stat-label">Balance</span><span class="agent-stat-value">${Number(agent.balance).toFixed(2)} ${currencySymbol}</span></div>
          <div class="agent-stat"><span class="agent-stat-label">PnL</span><span class="agent-stat-value ${Number(agent.pnl) >= 0 ? 'bid-color' : 'ask-color'}">${Number(agent.pnl) > 0 ? '+' : ''}${Number(agent.pnl).toFixed(4)} ${currencySymbol}</span></div>
          <div class="agent-stat"><span class="agent-stat-label">Trades</span><span class="agent-stat-value">${agent.tradeCount}</span></div>
          <div class="agent-stat"><span class="agent-stat-label">A Shares</span><span class="agent-stat-value bid-color">${formatBigNumber(agent.position.aShares)}</span></div>
          <div class="agent-stat"><span class="agent-stat-label">B Shares</span><span class="agent-stat-value ask-color">${formatBigNumber(agent.position.bShares)}</span></div>
          <div class="agent-stat"><span class="agent-stat-label">A Stake</span><span class="agent-stat-value">${Number(agent.position.aStake).toFixed(4)} ${currencySymbol}</span></div>
          <div class="agent-stat"><span class="agent-stat-label">B Stake</span><span class="agent-stat-value">${Number(agent.position.bStake).toFixed(4)} ${currencySymbol}</span></div>
          <div class="agent-stat" style="grid-column: 1 / -1"><span class="agent-stat-label">Active Orders</span><span class="agent-stat-value">${agent.activeOrders}</span></div>
          <div class="agent-stat" style="grid-column: 1 / -1"><span class="agent-stat-label">Address</span><span class="agent-stat-value" style="font-size: 0.65rem" title="${agent.address}">${shortAddr(agent.address)}</span></div>
        </div>
      `;
            agentsGrid.appendChild(card);
        }

        // Bind toggle buttons
        for (const btn of agentsGrid.querySelectorAll(".agent-toggle")) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                send({ command: "toggle_agent", strategy: btn.dataset.strategy });
            });
        }
    }

    // ─── Event Tape ─────────────────────────────────────────────────────────
    function formatEvent(ev) {
        const time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString("en-US", { hour12: false }) : "—";
        const name = ev.event || "unknown";
        let detail = "";

        if (ev.args) {
            const a = ev.args;
            if (name === "OrderPlaced") {
                const sideLabel = a.side === "1" || a.side === 1 ? "BUY" : "SELL";
                const sideClass = sideLabel === "BUY" ? "bid-color" : "ask-color";
                detail = `<span class="${sideClass}">${sideLabel}</span> @${a.price} x${formatBigNumber(a.amount)} by ${shortAddr(a.maker || "?")} (order #${a.orderId || "?"})`;
            } else if (name === "OrderMatched") {
                detail = `Maker #${a.makerOrderId} ↔ Taker #${a.takerOrderId} x${formatBigNumber(a.matchedAmount)} @${a.price}`;
            } else if (name === "OrderCancelled") {
                detail = `Order #${a.orderId}`;
            } else if (name === "MarketCreated") {
                detail = `Kind ${a.marketKind}`;
            } else if (name === "MarketSynced") {
                const statusNames = ["NULL", "OPEN", "LOCKED", "RESOLVED", "CANCELLED"];
                detail = `Status → ${statusNames[Number(a.status)] || a.status}`;
            } else {
                detail = JSON.stringify(a);
            }
        }

        return {
            html: `<span class="tape-time">${time}</span><span><strong style="color: var(--text-secondary)">${name}</strong> ${detail}</span>`,
            cls: `event-${name}`,
        };
    }

    function formatLog(log) {
        const tick = log.tick || 0;
        return {
            html: `<span class="tape-time">T${tick}</span><span>${log.message}</span>`,
            cls: "event-log",
        };
    }

    function addTapeEntry(entry, bulk) {
        tapeEntries.push(entry);
        if (tapeEntries.length > MAX_TAPE) tapeEntries.shift();

        const el = document.createElement("div");
        el.className = `tape-entry ${entry.cls}`;
        el.innerHTML = entry.html;

        if (!bulk) {
            eventTape.prepend(el);
        } else {
            eventTape.appendChild(el);
        }

        // Trim DOM
        while (eventTape.children.length > MAX_TAPE) {
            eventTape.removeChild(eventTape.lastChild);
        }

        eventCount.textContent = tapeEntries.length;
    }

    // ─── Utilities ──────────────────────────────────────────────────────────
    function shortAddr(addr) {
        if (!addr || addr.length < 10) return addr || "—";
        return addr.slice(0, 6) + "…" + addr.slice(-4);
    }

    function formatBigNumber(val) {
        let n = typeof val === "string" ? Number(val) : val;
        n = n / 1e14; // Scale down from WEI-equivalent sizes to original display units
        if (isNaN(n) || n === 0) return "0";
        if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
        if (n >= 1) return n.toFixed(1);
        if (n > 0) return "<1";
        return String(n);
    }

    function formatAtomicAmount(value, decimals, symbol, unit) {
        const raw = `${value ?? "0"}`;
        const negative = raw.startsWith("-");
        const digits = negative ? raw.slice(1) : raw;
        if (!/^\d+$/.test(digits)) return `${raw} ${symbol}`;
        if (/^0+$/.test(digits)) return `0.0000 ${symbol}`;

        const padded = digits.padStart(decimals + 1, "0");
        const whole = padded.slice(0, -decimals) || "0";
        const leadingFraction = decimals > 0
            ? padded.slice(-decimals, -decimals + 4).padEnd(4, "0")
            : "0000";

        if (whole === "0" && /^0+$/.test(leadingFraction)) {
            return `${negative ? "-" : ""}${digits} ${String(unit || symbol).toUpperCase()}`;
        }

        return `${negative ? "-" : ""}${whole}.${leadingFraction} ${symbol}`;
    }

    // ─── Event Bindings ─────────────────────────────────────────────────────
    $("btn-start").addEventListener("click", () => send({ command: "start" }));
    $("btn-pause").addEventListener("click", () => send({ command: "pause" }));
    $("btn-step").addEventListener("click", () => send({ command: "step" }));

    $("btn-resolve-a").addEventListener("click", () => send({ command: "resolve", winner: "A" }));
    $("btn-resolve-b").addEventListener("click", () => send({ command: "resolve", winner: "B" }));
    $("btn-new-duel").addEventListener("click", () => send({ command: "new_duel" }));

    speedSlider.addEventListener("input", () => {
        const v = speedSlider.value;
        speedValueEl.textContent = v + "ms";
        send({ command: "speed", value: Number(v) });
    });

    scenarioSelect.addEventListener("change", () => {
        if (scenarioSelect.value) {
            send({ command: "scenario", value: scenarioSelect.value });
        }
    });

    // ─── Network Visualizer (D3) ──────────────────────────────────────────────
    function initVisualizer() {
        if (!window.d3) return;
        const width = visContainer.clientWidth || 600;
        const height = visContainer.clientHeight || 300;

        visSvg = d3.select("#visualizer-container")
            .append("svg")
            .attr("width", width)
            .attr("height", height);

        // Define glow filter
        const defs = visSvg.append("defs");
        const filter = defs.append("filter").attr("id", "glow");
        filter.append("feGaussianBlur").attr("stdDeviation", "3.5").attr("result", "coloredBlur");
        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // Define fixed positions for core
        coreNodes.clob.fx = width / 2;
        coreNodes.clob.fy = height / 2;
        coreNodes.oracle.fx = width / 2;
        coreNodes.oracle.fy = 40;

        visNodes = [coreNodes.clob, coreNodes.oracle];
        visLinks = [{ source: "ORACLE", target: "CLOB" }];

        visSimulation = d3.forceSimulation(visNodes)
            .force("link", d3.forceLink(visLinks).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(d => d.radius + 10))
            .on("tick", ticked);

        drawVisualizer();
    }

    function updateVisualizer(state) {
        if (!window.d3 || !visSimulation) return;

        const currentNodes = new Map(visNodes.map(n => [n.id, n]));
        let modified = false;

        // Ensure agents are in nodes
        if (state.agents) {
            for (const agent of state.agents) {
                if (agent.enabled && !currentNodes.has(agent.address)) {
                    const newNode = {
                        id: agent.address,
                        group: "agent",
                        radius: 18,
                        label: agent.strategy,
                        color: agent.color || "#94a3b8"
                    };
                    visNodes.push(newNode);
                    visLinks.push({ source: agent.address, target: "CLOB" });
                    currentNodes.set(agent.address, newNode);
                    modified = true;
                } else if (!agent.enabled && currentNodes.has(agent.address)) {
                    visNodes = visNodes.filter(n => n.id !== agent.address);
                    visLinks = visLinks.filter(l => l.source.id !== agent.address && l.source !== agent.address);
                    currentNodes.delete(agent.address);
                    modified = true;
                }
            }
        }

        if (modified) {
            visSimulation.nodes(visNodes);
            visSimulation.force("link").links(visLinks);
            drawVisualizer();
            visSimulation.alpha(0.3).restart();
        }
    }

    function drawVisualizer() {
        // Links
        let linkGroup = visSvg.select(".links");
        if (linkGroup.empty()) linkGroup = visSvg.append("g").attr("class", "links");
        
        linkElements = linkGroup.selectAll("line")
            .data(visLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`);
            
        linkElements.exit().remove();
        const linkEnter = linkElements.enter().append("line")
            .attr("stroke", "rgba(71, 85, 105, 0.4)")
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", d => d.source.id === "ORACLE" || d.source === "ORACLE" ? "5,5" : "none");
            
        linkElements = linkEnter.merge(linkElements);

        // Nodes
        let nodeGroup = visSvg.select(".nodes");
        if (nodeGroup.empty()) nodeGroup = visSvg.append("g").attr("class", "nodes");

        nodeElements = nodeGroup.selectAll("g.node")
            .data(visNodes, d => d.id);
            
        nodeElements.exit().transition().duration(300).attr("r", 0).remove();
        
        const nodeEnter = nodeElements.enter().append("g")
            .attr("class", "node")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        nodeEnter.append("circle")
            .attr("r", 0)
            .attr("fill", d => d.color)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .style("filter", "url(#glow)")
            .transition().duration(500)
            .attr("r", d => d.radius);

        nodeEnter.append("text")
            .attr("dy", d => d.radius + 12)
            .attr("text-anchor", "middle")
            .attr("font-family", "Inter")
            .attr("font-size", d => d.group === "core" ? "10px" : "9px")
            .attr("fill", "#cbd5e1")
            .attr("font-weight", d => d.group === "core" ? "600" : "400")
            .each(function(d) {
                if (d.label.includes("\n")) {
                    const lines = d.label.split("\n");
                    d3.select(this).text(lines[0]);
                    d3.select(this).append("tspan").attr("x", 0).attr("dy", "1.2em").text(lines[1]);
                } else {
                    d3.select(this).text(d.label);
                }
            });

        nodeElements = nodeEnter.merge(nodeElements);
    }

    function ticked() {
        if (!linkElements || !nodeElements) return;

        // Constrain agents to ellipse bounds
        const width = visContainer.clientWidth || 600;
        const height = visContainer.clientHeight || 300;
        
        nodeElements.attr("transform", d => {
            if (d.group !== "core") {
                d.x = Math.max(d.radius, Math.min(width - d.radius, d.x));
                d.y = Math.max(d.radius, Math.min(height - d.radius, d.y));
            }
            return `translate(${d.x},${d.y})`
        });

        linkElements
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
    }

    function dragstarted(event, d) {
        if (!event.active) visSimulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) visSimulation.alphaTarget(0);
        if (d.group !== "core") {
            d.fx = null;
            d.fy = null;
        }
    }

    function triggerInteractionEvent(ev) {
        if (!visSvg || !state) return;

        const name = ev.event;
        if (!name) return;

        let sourceId = null;
        let targetId = "CLOB";
        let color = "#cbd5e1";

        if (name === "OrderPlaced") {
            sourceId = ev.args?.maker;
            const side = ev.args?.side;
            color = (side === "1" || side === 1) ? "#22d3ee" : "#f472b6"; // Buy Cyan, Sell Magenta
        } else if (name === "OrderCancelled") {
            sourceId = ev.args?.maker; // Note: Current GoldClob args for cancel might just be orderId. We can try to map.
            // fallback, emit from all nodes if we don't know who? No, let's just use grey.
            color = "#94a3b8"; 
        } else if (name === "MarketSynced" || name === "MarketCreated") {
            sourceId = "ORACLE";
            color = "#fbbf24";
        } else if (name === "OrderMatched") {
            // Pulse on CLOB itself
            pulseNode("CLOB", "#fbbf24");
            return;
        }

        if (sourceId) {
            shootPulse(sourceId, targetId, color);
            pulseNode(sourceId, color);
        }
    }

    function pulseNode(nodeId, color) {
        const nodeGroup = nodeElements.filter(d => d.id === nodeId);
        if (nodeGroup.empty()) return;
        const circle = nodeGroup.select("circle");
        
        // Add a pulsing ring
        const ring = nodeGroup.append("circle")
            .attr("r", circle.attr("r"))
            .attr("fill", "none")
            .attr("stroke", color)
            .attr("stroke-width", 3);

        ring.transition()
            .duration(600)
            .ease(Math.sqrt)
            .attr("r", parseInt(circle.attr("r") || 0) + 15)
            .style("opacity", 0)
            .remove();
    }

    function shootPulse(sourceId, targetId, color) {
        const sourceNode = visNodes.find(n => n.id === sourceId);
        const targetNode = visNodes.find(n => n.id === targetId);

        if (!sourceNode || !targetNode) return;

        const p = visSvg.append("circle")
            .attr("cx", sourceNode.x)
            .attr("cy", sourceNode.y)
            .attr("r", 5)
            .attr("fill", color)
            .style("filter", "url(#glow)");

        p.transition()
            .duration(300)
            .ease(d3.easeCubicInOut)
            .attr("cx", targetNode.x)
            .attr("cy", targetNode.y)
            .remove();
    }

    // ─── Boot ───────────────────────────────────────────────────────────────
    connect();
})();
