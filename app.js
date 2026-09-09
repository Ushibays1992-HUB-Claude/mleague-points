const PARTICIPANT_COLORS = {
  "うし": "#3f7fd9",
  "犬丼": "#e0a02f",
  "ちんさん": "#f4a8ba",
  "木村": "#d1393e",
  "ヤンマ": "#2fa88f",
};

function formatPoints(n) {
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1);
}

function pointsClass(n) {
  if (n > 0) return "pts-positive";
  if (n < 0) return "pts-negative";
  return "pts-zero";
}

function formatPointsHtml(n) {
  return `<span class="${pointsClass(n)}">${formatPoints(n)}</span>`;
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
        <td class="points">${formatPointsHtml(value)}</td>
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

const CHART_RIGHT_PADDING = 60;

// 各系列の最終値の位置に参加者名を描画するプラグイン(近い値は少しずらして重なりを回避)
const endLabelsPlugin = {
  id: "endLabels",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    const items = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden || !meta.data.length) return;
      const last = meta.data[meta.data.length - 1];
      items.push({ label: ds.label, color: ds.borderColor, y: last.y });
    });
    items.sort((a, b) => a.y - b.y);
    const minGap = 14;
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < minGap) {
        items[i].y = items[i - 1].y + minGap;
      }
    }

    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    items.forEach((it) => {
      ctx.fillStyle = it.color;
      ctx.fillText(it.label, chartArea.right + 6, it.y);
    });
    ctx.restore();
  },
};

function renderPointsChart(canvasEl, history, key, participants) {
  const labels = history.map((r) => r.date);
  const datasets = participants.map((name) => {
    const data = history.map((r) => r[key][name]);
    return {
      label: name,
      data,
      borderColor: PARTICIPANT_COLORS[name] || "#888",
      backgroundColor: PARTICIPANT_COLORS[name] || "#888",
      tension: 0.15,
      spanGaps: true,
    };
  });

  const allValues = datasets.flatMap((d) => d.data);
  const maxAbs = Math.max(10, ...allValues.map((v) => Math.abs(v)));
  const bound = Math.ceil((maxAbs * 1.15) / 10) * 10;

  new Chart(canvasEl, {
    type: "line",
    data: { labels, datasets },
    plugins: [endLabelsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: CHART_RIGHT_PADDING } },
      scales: {
        y: {
          min: -bound,
          max: bound,
        },
        x: {},
      },
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
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
      clip: { left: 0, right: 0, top: 8, bottom: 8 },
    };
  });

  new Chart(canvasEl, {
    type: "line",
    data: { labels, datasets },
    plugins: [endLabelsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: CHART_RIGHT_PADDING } },
      scales: {
        y: {
          reverse: true,
          min: 1,
          max: participants.length,
          ticks: { stepSize: 1 },
        },
        x: {},
      },
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
}

async function main() {
  const [draftResults, history, latestPlayerPoints, playerPhotos, teamLogos] = await Promise.all([
    fetch("data/draft_results.json").then((r) => r.json()),
    fetch("data/history.json").then((r) => (r.ok ? r.json() : [])),
    fetch("data/latest_player_points.json").then((r) => (r.ok ? r.json() : {})),
    fetch("data/player_photos.json").then((r) => (r.ok ? r.json() : {})),
    fetch("data/team_logos.json").then((r) => (r.ok ? r.json() : {})),
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

  const playersOf = (name) => {
    const rows = draftResults.player_draft.results[name]
      .map((p) => {
        const pts = latestPlayerPoints[p.name];
        const ptsText = typeof pts === "number" ? formatPointsHtml(pts) : "-";
        const photoUrl = playerPhotos[p.name];
        const photo = photoUrl
          ? `<img class="player-photo" src="${photoUrl}" alt="" loading="lazy">`
          : `<span class="player-photo" aria-hidden="true"></span>`;
        return `<div class="player-row">
          ${photo}
          <span class="player-name">${p.name}</span>
          <span class="player-pts">${ptsText}</span>
        </div>`;
      })
      .join("");
    return `<div class="player-grid">${rows}</div>`;
  };
  const teamOf = (name) => {
    const teamName = draftResults.team_draft.results[name];
    const logoUrl = teamLogos[teamName];
    const logo = logoUrl
      ? `<img class="team-logo" src="${logoUrl}" alt="" loading="lazy">`
      : "";
    return `<span class="team-row">${logo}<span>${teamName}</span></span>`;
  };

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
    renderPointsChart(
      document.getElementById("chart-purpose1"),
      history,
      "purpose1",
      participants
    );
    renderRankChart(
      document.getElementById("chart-purpose2"),
      history,
      "purpose2",
      participants
    );
  } else {
    document.querySelectorAll(".chart-section").forEach((el) => (el.hidden = true));
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById("updated-at").textContent = "データの読み込みに失敗しました";
});
