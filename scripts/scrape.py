"""Mリーグ公式サイトの統計APIから選手ポイントを取得し、参加者ごとの集計をhistory.jsonに追記する。"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

# 2026-11の不正アクセス事故に伴うサイト再構築後、/statsページはJSで後から
# 書き換えられる仕組みに変わり、静的HTMLには0しか入らなくなった。
# 実データはこのJSON APIから取得する(ブラウザのネットワークログから特定)。
STATS_API_URL = "https://m-league.jp/api/mleague/data?kind=stats"
JST = timezone(timedelta(hours=9))
SEASON_END_DATE = datetime(2027, 3, 3, tzinfo=JST).date()

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DRAFT_RESULTS_PATH = DATA_DIR / "draft_results.json"
HISTORY_PATH = DATA_DIR / "history.json"
LATEST_PLAYER_POINTS_PATH = DATA_DIR / "latest_player_points.json"


def fetch_player_points() -> dict:
    """team_name -> {player_name: points} を返す"""
    resp = requests.get(
        STATS_API_URL,
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://m-league.jp/stats/"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    result = {}
    for team in data["stats"]["teams"]:
        team_name = team["team"]
        players = team["players"]
        points_metric = next(
            (m for m in team["metrics"] if m["name"] == "ポイント"), None
        )
        if points_metric is None:
            continue
        points = points_metric["values"]
        if players and points and len(players) == len(points):
            result[team_name] = dict(zip(players, points))

    return result


def normalize_team_name(name: str) -> str:
    return name.replace(" ", "").replace("　", "").replace("/", "")


def find_team_total(team_points: dict, target_name: str) -> float:
    """公式サイト側のチーム名表記揺れ（スペース追加・「/ 雷電」等の別名併記）を吸収して合計を探す"""
    if target_name in team_points:
        return team_points[target_name]
    norm_target = normalize_team_name(target_name)
    for team, total in team_points.items():
        norm_team = normalize_team_name(team)
        if norm_team == norm_target or norm_target in norm_team or norm_team in norm_target:
            return total
    return 0.0


def compute_totals(player_points_by_team: dict, draft_results: dict) -> tuple[dict, dict, dict]:
    all_player_points = {}
    team_points = {}
    for team, players in player_points_by_team.items():
        all_player_points.update(players)
        team_points[team] = sum(players.values())

    purpose1 = {}
    for participant in draft_results["participants"]:
        drafted_players = draft_results["player_draft"]["results"][participant]
        purpose1[participant] = sum(
            all_player_points.get(p["name"], 0.0) for p in drafted_players
        )

    purpose2 = {}
    for participant, drafted_team in draft_results["team_draft"]["results"].items():
        purpose2[participant] = find_team_total(team_points, drafted_team)

    return purpose1, purpose2, all_player_points


def load_history() -> list:
    if HISTORY_PATH.exists():
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    return []


def main() -> int:
    now = datetime.now(JST)
    today = now.date()
    if today > SEASON_END_DATE:
        print(f"season already ended (today={today} > {SEASON_END_DATE}); skipping scrape")
        return 0

    draft_results = json.loads(DRAFT_RESULTS_PATH.read_text(encoding="utf-8"))
    player_points_by_team = fetch_player_points()
    if not player_points_by_team:
        print("no data parsed from stats page; aborting without writing", file=sys.stderr)
        return 1

    purpose1, purpose2, all_player_points = compute_totals(player_points_by_team, draft_results)

    LATEST_PLAYER_POINTS_PATH.write_text(
        json.dumps(all_player_points, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    history = load_history()
    if history:
        last = history[-1]
        if last.get("players") == all_player_points:
            print("no change since last recorded entry; skipping")
            return 0

    record = {
        "date": today.isoformat(),
        "time": now.strftime("%H:%M"),
        "purpose1": purpose1,
        "purpose2": purpose2,
        "players": all_player_points,
    }
    history.append(record)
    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"appended record for {today.isoformat()} {record['time']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
