"""Build data/thesaurus.txt, the synonym data for Lyricpad's Thesaurus tab.

Inputs
  data/dict.txt   Lyricpad's pronunciation dictionary (see build_dict.py); decides
                  which words are offered and how common they are
  wordnet_dict/   WordNet 3.1 database directory (data.noun, data.verb, ...), e.g.
                  from the `wordnet-db` npm package. Synonyms grouped by meaning.
  moby.txt        Moby Thesaurus II (public domain), one line per root word:
                  "root,syn1,syn2,...", e.g. from the `moby` npm package.
                  A much larger pool of related words.

Output (plain text, sections start with "#"):
  #WORDS     one word or phrase per line, most common first; other sections refer
             to them by their line number in base 36
  #SENSES    one WordNet meaning per line: "pos|short definition|w,w,w"
  #WORDNET   "word:sense,sense,..." - a word's meanings, most common first
  #MOBY      "word:w,w,w,..." - extra related words, most common first

Usage:
  python3 tools/build_thesaurus.py data/dict.txt wordnet_dict/ moby.txt > data/thesaurus.txt
"""
import math
import os
import re
import sys

dict_path, wn_dir, moby_path = sys.argv[1:4]

# ---- vocabulary: words Lyricpad offers as results, ranked by commonness ----
rank = {}
common_count = 0
common = set()
_seen = {}


def dict_order(line):
    """Position of the line's word among all distinct dictionary words (hidden ones included)."""
    w = re.sub(r"\(\d+\)$", "", line.split(" ", 1)[0].lstrip("!"))
    return _seen.setdefault(w, len(_seen))


for i, line in enumerate(open(dict_path, encoding="utf-8")):
    if i == 0:
        common_count = int(line.split()[1])  # "#COMMON n": the first n distinct words are common
        continue
    if line.startswith("!"):
        dict_order(line)
        continue
    word = re.sub(r"\(\d+\)$", "", line.split(" ", 1)[0])
    if word not in rank:
        rank[word] = len(rank)
        if dict_order(line) < common_count:
            common.add(word)

MAX_PHRASE_WORDS = 3


def norm(term):
    """Return the term in Lyricpad's vocabulary form, or None if it isn't usable."""
    t = term.replace("_", " ").strip()
    t = re.sub(r"\([a-z]+\)$", "", t)  # WordNet adjective markers: "(a)", "(p)", "(ip)"
    if not t or t != t.lower() or not re.fullmatch(r"[a-z' -]+", t):
        return None
    parts = re.split(r"[ -]+", t)
    if len(parts) > MAX_PHRASE_WORDS or not all(p in rank for p in parts):
        return None
    return t


def term_rank(t):
    """Phrases rank after single words, by their rarest word."""
    parts = re.split(r"[ -]+", t)
    if len(parts) == 1:
        return rank[t]
    return 10**6 + max(rank[p] for p in parts)


# ---- WordNet ----
POS = {"noun": "n", "verb": "v", "adj": "adj", "adv": "adv"}
synsets = {}  # (pos, offset) -> {"words": [...], "gloss": str, "similar": [keys]}
for name, pos in POS.items():
    for line in open(os.path.join(wn_dir, "data." + name), encoding="latin-1"):
        if line.startswith("  "):
            continue
        head, _, gloss = line.partition("|")
        f = head.split()
        offset, ss_type = f[0], f[2]
        n = int(f[3], 16)
        words = [f[4 + 2 * i] for i in range(n)]
        p = 4 + 2 * n
        ptr_count = int(f[p])
        similar = []
        for i in range(ptr_count):
            sym, off, ppos = f[p + 1 + 4 * i], f[p + 2 + 4 * i], f[p + 3 + 4 * i]
            if sym == "&":  # "similar to" links adjective clusters together
                similar.append(("adj" if ppos in "as" else POS.get(ppos, ppos), off))
        definition = gloss.split(";")[0].strip().strip('"')
        if len(definition) > 70:
            definition = definition[:67].rsplit(" ", 1)[0] + "…"
        synsets[(pos, offset)] = {"words": words, "gloss": definition, "similar": similar}

word_senses = {}  # term -> [(pos, offset), ...] in WordNet's frequency order
for name, pos in POS.items():
    for line in open(os.path.join(wn_dir, "index." + name), encoding="latin-1"):
        if line.startswith("  "):
            continue
        f = line.split()
        term = norm(f[0])
        if not term:
            continue
        p_cnt = int(f[3])
        offsets = f[6 + p_cnt:]
        word_senses.setdefault(term, []).extend((pos, o) for o in offsets)

sense_ids = {}
sense_rows = []
wordnet_rows = {}
MAX_SENSES = 10
for term, keys in word_senses.items():
    if term not in rank:  # only single dictionary words get WordNet lookups
        continue
    ids = []
    for key in keys:
        ss = synsets[key]
        members = [norm(w) for w in ss["words"]]
        for sk in ss["similar"]:
            members += [norm(w) for w in synsets[sk]["words"]]
        members = list(dict.fromkeys(m for m in members if m and m != term))
        if not members:
            continue
        if key not in sense_ids:
            members.sort(key=term_rank)
            sense_ids[key] = len(sense_rows)
            sense_rows.append((key[0], ss["gloss"], members))
        ids.append(sense_ids[key])
        if len(ids) >= MAX_SENSES:
            break
    if ids:
        wordnet_rows[term] = ids

# ---- Moby ----
# Moby is huge and loose, so keep it to common words: roots and results alike.
MAX_MOBY = 100


def is_common(t):
    return all(p in common for p in re.split(r"[ -]+", t))



# Moby lists are alphabetical with no notion of relevance, so rank each root's words by how
# many related words they share with the root (scaled down for "hub" words that are related
# to everything). Words in the same WordNet meaning as the root still come first.
moby_all = {}
for line in open(moby_path, encoding="latin-1"):
    root, *syns = line.rstrip("\n").split(",")
    root = norm(root)
    if not root or root not in common:
        continue
    terms = [t for t in map(norm, syns) if t and t != root and is_common(t)]
    moby_all.setdefault(root, set()).update(terms)

wordnet_mates = {}
for term, ids in wordnet_rows.items():
    wordnet_mates[term] = {w for i in ids for w in sense_rows[i][2]}

moby_rows = {}
for root, terms in moby_all.items():
    mates = wordnet_mates.get(root, set())

    def strength(t):
        theirs = moby_all.get(t, set())
        shared = len(terms & theirs) / math.sqrt(len(theirs) + 5)
        return (t not in mates, -shared, term_rank(t))

    ranked = sorted(terms, key=strength)[:MAX_MOBY]
    if ranked:
        moby_rows[root] = ranked

# ---- word table ----
used = set(wordnet_rows) | set(moby_rows)
for _, _, members in sense_rows:
    used.update(members)
for terms in moby_rows.values():
    used.update(terms)
words = sorted(used, key=lambda t: (term_rank(t), t))
index = {w: i for i, w in enumerate(words)}


def b36(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if not n:
            return out


def ref(terms):
    return ",".join(b36(index[t]) for t in terms)


out = ["#WORDS", *words, "#SENSES"]
out += [f"{pos}|{gloss.replace('|', '/')}|{ref(m)}" for pos, gloss, m in sense_rows]
out.append("#WORDNET")
out += [f"{b36(index[t])}:{','.join(b36(i) for i in ids)}" for t, ids in wordnet_rows.items()]
out.append("#MOBY")
out += [f"{b36(index[t])}:{ref(terms)}" for t, terms in moby_rows.items()]
sys.stdout.write("\n".join(out) + "\n")
