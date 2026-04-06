from __future__ import annotations

import json
import re
from pathlib import Path

REPO_DIR = Path("/Users/ethanzhang/Library/CloudStorage/OneDrive-Personal/Coding/spanish-quiz-site")
AUDIO_DIR = REPO_DIR / "docs" / "audio"
OUT_PATH = REPO_DIR / "docs" / "data" / "a2_listening_audio_manifest.json"

AUDIO_EXTS = {".mp3", ".m4a", ".ogg", ".wav", ".aac", ".webm"}

def rel_web_path(p: Path) -> str:
    return "./" + p.relative_to(REPO_DIR / "docs").as_posix()

def mime_for_ext(ext: str) -> str:
    ext = ext.lower()
    return {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".wav": "audio/wav",
        ".aac": "audio/aac",
        ".webm": "audio/webm",
    }.get(ext, "audio/mpeg")

def normalize_model_folder_name(name: str) -> int | None:
    m = re.search(r"modelo\s*([1-4])", name, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"model[_\s-]*0*([1-4])", name, re.I)
    if m:
        return int(m.group(1))
    return None

def infer_task_num(path: Path) -> int | None:
    s = path.stem.lower()

    patterns = [
        r"(?:task|tarea)[ _-]*0*([1-4])",
        r"\bt[ _-]*0*([1-4])\b",
        r"(?:listening|audio|aud)[ _-]*0*([1-4])\b",
    ]
    for pat in patterns:
        m = re.search(pat, s, re.I)
        if m:
            return int(m.group(1))

    # 最后兜底：如果文件名里有独立的 1/2/3/4，也试一次
    nums = re.findall(r"(?<!\d)([1-4])(?!\d)", s)
    if len(nums) == 1:
        return int(nums[0])

    return None

def collect_audio_files(folder: Path) -> list[Path]:
    return sorted(
        [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTS],
        key=lambda p: p.as_posix().lower()
    )

def choose_best_by_task(files: list[Path]) -> dict[int, list[Path]]:
    by_task: dict[int, list[Path]] = {1: [], 2: [], 3: [], 4: []}

    for f in files:
        t = infer_task_num(f)
        if t in by_task:
            by_task[t].append(f)

    return by_task

def main() -> int:
    if not AUDIO_DIR.exists():
        raise SystemExit(f"没找到音频目录：{AUDIO_DIR}")

    model_dirs = [p for p in AUDIO_DIR.iterdir() if p.is_dir()]
    manifest: dict[str, dict] = {}
    report: list[str] = []

    for model_dir in sorted(model_dirs, key=lambda p: p.name):
        model_num = normalize_model_folder_name(model_dir.name)
        if model_num is None:
            report.append(f"跳过无法识别的目录：{model_dir.name}")
            continue

        audio_files = collect_audio_files(model_dir)
        if not audio_files:
            report.append(f"MODEL {model_num}: 没找到音频文件")
            continue

        by_task = choose_best_by_task(audio_files)

        for task_num in [1, 2, 3, 4]:
            task_key = f"M{model_num}_T{task_num}"
            files = by_task[task_num]

            if not files:
                report.append(f"{task_key}: 没匹配到文件")
                continue

            sources = []
            # 同一个 task 下，把不同格式都收进去
            seen = set()
            for f in files:
                web_path = rel_web_path(f)
                if web_path in seen:
                    continue
                seen.add(web_path)
                sources.append(
                    {
                        "src": web_path,
                        "type": mime_for_ext(f.suffix),
                        "filename": f.name,
                    }
                )

            manifest[task_key] = {
                "title": f"Model {model_num} · Listening · Task {task_num}",
                "model": model_num,
                "task": task_num,
                "folder": model_dir.name,
                "sources": sources,
            }
            report.append(f"{task_key}: {', '.join(x['filename'] for x in sources)}")

    OUT_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"已生成：{OUT_PATH}")
    print("")
    print("====== Manifest 报告 ======")
    for line in report:
        print(line)

    print("")
    print("====== 预览前 20 项 ======")
    for k in list(manifest.keys())[:20]:
        print(k, "->", [x["filename"] for x in manifest[k]["sources"]])

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
