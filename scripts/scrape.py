"""Mリーグ公式サイト(/stats)から選手ポイントを取得し、参加者ごとの集計をhistory.jsonに追記する。"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

STATS_URL = "https://m-league.jp/stats/?season=L001_S025"
JST = timezone(timedelta(hours=9))
SEASON_END_DATE = datetime(2027, 3, 3, tzinfo=JST).date()

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DRAFT_RESULTS_PATH = DATA_DIR / "draft_results.json"
HISTORY_PATH = DATA_DIR / "history.json"
LATEST_PLAYER_POINTS_PATH = DATA_DIR / "latest_player_points.json"


def parse_point(text: str) -> float:
    text = text.strip().replace(",", "")
    if text in ("", "-", "―", "―pt"):
        return 0.0
    negative = text.startswith("▲") or text.startswith("△")
    text = text.lstrip("▲△")
    try:
        value = float(text)
    except ValueError:
        return 0.0
    return -value if negative else value


def fetch_player_points() -> dict:
    """team_name -> {player_name: points} を返す"""
    resp = requests.get(STATS_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    result = {}
    for section in soup.select("section.p-stats__team"):
        team_name_tag = section.select_one("h2.p-stats__teamName")
        if not team_name_tag:
            continue
        team_name = team_name_tag.get_text(strip=True)

        table = section.select_one("table.p-stats__table")
        if not table:
            continue
        rows = table.find_all("tr")

        player_names = []
        points = []
        for row in rows:
            header = row.find("th", attrs={"scope": "row"})
            if header is None:
                continue
            label = header.get_text(strip=True)
            if label == "選手名":
                player_names = [th.get_text(strip=True) for th in row.find_all("th", attrs={"scope": "col"})]
            elif label == "ポイント":
                points = [parse_point(td.get_text()) for td in row.find_all("td")]

        if player_names and points and len(player_names) == len(points):
            result[team_name] = dict(zip(player_names, points))

    return result


def compute_totals(player_points_by_team: dict, draft_results: dict) -> tuple[dict, dict, dict]:
    all_player_points = {}
    team_points = {}
    for team, players in player_points_by_team.items():
        all_player_points.update(players)
        team_points[team] = sum(players.values())

    purpose1 = {}
    purpose2 = {}
    for participant in draft_results["participants"]:
        drafted_players = draft_results["player_draft"]["results"][participant]
        purpose1[participant] = sum(
            all_player_points.get(p["name"], 0.0) for p in drafted_players
        )
        drafted_team = draft_results["team_draft"]["results"][participant]
        purpose2[participant] = team_points.get(drafted_team, 0.0)

    return purpose1, purpose2, all_player_points


def load_history() -> list:
    if HISTORY_PATH.exists():
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    return []


def main() -> int:
    today = datetime.now(JST).date()
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
        "purpose1": purpose1,
        "purpose2": purpose2,
        "players": all_player_points,
    }
    history.append(record)
    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"appended record for {today.isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
