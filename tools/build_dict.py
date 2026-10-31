"""Build data/dict.txt, the pronunciation data Lyricpad loads in the browser.

Inputs
  cmudict.dict   CMU Pronouncing Dictionary
                 https://github.com/cmusphinx/cmudict
  en_50k.txt     word frequencies from film/TV subtitles
                 https://github.com/hermitdave/FrequencyWords (content/2018/en/en_50k.txt)
  words.txt      SCOWL English words, one per line (size <= 70, American + British,
                 merged from the `wordlist-english` npm package)

Output: one entry per line, "word PH1 PH2 ...", with pronunciation variants
written as "word(2)". Lines are ordered by word frequency (most common first),
followed by words absent from the frequency list (alphabetical). The first
line is "#COMMON <n>": the number of distinct words found in the frequency
list, so the app can tell common words from rare ones.

Entries that shouldn't be offered as rhymes (proper names, abbreviations,
obscure entries) are prefixed with "!" - they still count syllables. A word
is offered if it's in the SCOWL list, or if it's a common contraction like
"nothin'".

Usage: python3 tools/build_dict.py cmudict.dict en_50k.txt words.txt > data/dict.txt
"""
import re
import sys

cmu_path, freq_path, words_path = sys.argv[1:4]

english = {w.strip() for w in open(words_path, encoding="utf-8")}

rank = {}
for i, line in enumerate(open(freq_path, encoding="utf-8")):
    rank.setdefault(line.split()[0].lower(), i)


def listable(w):
    if w in ("a", "i"):
        return True
    if len(w) < 2 or not re.fullmatch(r"[a-z][a-z']*", w):
        return False
    return w in english or ("'" in w and w in rank)


entries = {}  # word -> [phones, ...]
for line in open(cmu_path, encoding="utf-8"):
    line = line.split("#")[0].strip()
    if not line:
        continue
    head, *phones = line.split()
    word = re.sub(r"\(\d+\)$", "", head)
    entries.setdefault(word, []).append(" ".join(phones))

common = sorted((w for w in entries if w in rank), key=lambda w: rank[w])
rare = sorted(w for w in entries if w not in rank)
out = [f"#COMMON {len(common)}"]
for w in common + rare:
    flag = "" if listable(w) else "!"
    for i, p in enumerate(entries[w]):
        out.append(f"{flag}{w if i == 0 else f'{w}({i + 1})'} {p}")
sys.stdout.write("\n".join(out) + "\n")
