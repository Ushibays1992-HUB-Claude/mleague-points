const PARTICIPANT_COLORS = {
  "うし": "#5b4de0",
  "犬丼": "#e05b7a",
  "ちんさん": "#2fa88f",
  "木村": "#e0a02f",
  "ヤンマ": "#3f7fd9",
};

function formatPoints(n) {
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1);
}

// 標準的な競技順位（同点は同順位、次の順位は人数分飛ぶ）
function rankOf(totals) {
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const ranks = {};
  entries.forEach(([name, value], i) => {
    if (i > 0 && entries[i - 1][1] === value) {
      ranks[name] = ranks[entries[i - 1][0]];
    } else {
      ranks[name] = i + 1;
    }
  });
  return { entries, ranks };
}

function renderTable(tableEl, totals, extraColumnHeader, extraColumnFn) {
  const { entries, ranks } = rankOf(totals);
  const rows = entries
    .map(([name, value]) => {
      const rank = ranks[name];
      const rankClass = rank <= 3 ? ` rank-${rank}` : "";
      return `<tr>
        <td class="rank-cell${rankClass}">${rank}</td>
        <td>${name}</td>
        <td class="points">${formatPoints(value)}</td>
        <td class="breakdown">${extraColumnFn(name)}</td>
      </tr>`;
    })
    .join("");
  tableEl.innerHTML = `
    <thead>
      <tr><th>順位</th><th>参加者</th><th>ポイント</th><th>${extraColumnHeader}</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  `;
}

function renderRankChart(canvasEl, history, key, participants) {
  const labels = history.map((r) => r.date);
  const datasets = participants.map((name) => {
    const data = history.map((r) => rankOf(r[key]).ranks[name]);
    return {
      label: name,
      data,
      borderColor: PARTICIPANT_COLORS[name] || "#888",
      backgroundColor: PARTICIPANT_COLORS[name] || "#888",
      tension: 0.15,
      spanGaps: true,
    };
  });

  new Chart(canvasEl, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          reverse: true,
          min: 1,
          max: participants.length,
          ticks: { stepSize: 1 },
          title: { display: true, text: "順位" },
        },
        x: {
          title: { display: true, text: "日付" },
        },
      },
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
}

async function main() {
  const [draftResults, history, latestPlayerPoints] = await Promise.all([
    fetch("data/draft_results.json").then((r) => r.json()),
    fetch("data/history.json").then((r) => (r.ok ? r.json() : [])),
    fetch("data/latest_player_points.json").then((r) => (r.ok ? r.json() : {})),
  ]);

  const participants = draftResults.participants;
  const latest = history.length ? history[history.length - 1] : {
    purpose1: Object.fromEntries(participants.map((p) => [p, 0])),
    purpose2: Object.fromEntries(participants.map((p) => [p, 0])),
  };

  document.getElementById("updated-at").textContent = history.length
    ? `最終更新: ${latest.date}`
    : "まだデータがありません（シーズン開幕待ち）";

  if (!history.length) {
    document.getElementById("empty-state").hidden = false;
  }

  const playersOf = (name) =>
    draftResults.player_draft.results[name]
      .map((p) => {
        const pts = latestPlayerPoints[p.name];
        const ptsText = typeof pts === "number" ? formatPoints(pts) : "-";
        return `${p.name}(${ptsText})`;
      })
      .join("・");
  const teamOf = (name) => draftResults.team_draft.results[name];

  renderTable(
    document.getElementById("table-purpose1"),
    latest.purpose1,
    "指名選手",
    playersOf
  );
  renderTable(
    document.getElementById("table-purpose2"),
    latest.purpose2,
    "指名チーム",
    teamOf
  );

  if (history.length) {
    renderRankChart(document.getElementById("chart-purpose1"), history, "purpose1", participants);
    renderRankChart(document.getElementById("chart-purpose2"), history, "purpose2", participants);
  } else {
    document.querySelectorAll(".chart-section").forEach((el) => (el.hidden = true));
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById("updated-at").textContent = "データの読み込みに失敗しました";
});
