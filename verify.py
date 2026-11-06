#!/usr/bin/env python3
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# License: https://polyformproject.org/licenses/noncommercial/1.0.0
# Required Notice: Copyright (c) 2026 Adrian Speyer (https://github.com/adrianspeyer/FairSpinner)
"""Independent FairSpin v1 verifier. Python 3, standard library only.

Usage: python3 verify.py fairspin-SESSION-audit.json

Verifies committed inputs, draw order, winners, random values, pool fingerprints,
animation results and recorded chronology. The optional whole-file checksum is
NOT recomputed: Python JSON serialization differs from JavaScript JSON.stringify.
Use the browser verifier to check that checksum. Neither verifier authenticates
the organizer or proves when the commitment was published.
"""

import datetime
import hashlib
import hmac
import json
import math
import re
import sys

MAX_BYTES = 10 * 1024 * 1024
HEX = re.compile(r"[0-9a-f]{64}\Z")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\Z")
# ECMAScript trim whitespace; Python str.strip() includes additional characters.
WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def string(value, maximum):
    if not isinstance(value, str):
        return False
    try:
        return len(value.encode("utf-16-le")) // 2 <= maximum
    except UnicodeEncodeError:
        return False


def fingerprint(value):
    return isinstance(value, str) and HEX.fullmatch(value) is not None


def digest(value):
    return hashlib.sha256(value).hexdigest()


def timestamp(value):
    require(isinstance(value, str) and DATE.fullmatch(value), "Invalid UTC timestamp")
    return datetime.datetime.fromisoformat(value[:-1] + "+00:00")


def verify(a):
    require(isinstance(a, dict) and a.get("format") == "fairspin-audit" and type(a.get("version")) is int and a["version"] == 1, "Expected a FairSpin version 1 audit")
    for section in ("list", "commitment", "entropy", "reveal", "session"):
        require(isinstance(a.get(section), dict), "Missing section: " + section)
    entries, c, entropy = a["list"].get("entries"), a["commitment"], a["entropy"]
    require(isinstance(entries, list) and 2 <= len(entries) <= 10000, "Expected 2–10000 entries")
    for entry in entries:
        require(string(entry, 512) and entry and entry.strip(WHITESPACE) == entry and "\r" not in entry and "\n" not in entry, "Entries must be trimmed, nonempty, single-line Unicode strings")
    require(type(a["list"].get("count")) is int and a["list"]["count"] == len(entries), "Entry count mismatch")
    for value in (a["list"].get("sha256"), c.get("listSha256"), c.get("seedSha256"), a["reveal"].get("seed")):
        require(fingerprint(value), "Invalid 32-byte lowercase hexadecimal value")
    options = a["list"].get("options")
    require(isinstance(options, dict) and type(options.get("dedupe")) is bool and type(options.get("caseInsensitive")) is bool, "Invalid list options")
    require(integer(a["list"].get("duplicatesRemoved"), 0, 2 * 1024 * 1024) and string(a["list"].get("source"), 4096), "Invalid list metadata")
    if options["dedupe"]:
        keys = [e.lower() if options["caseInsensitive"] else e for e in entries]
        require(len(set(keys)) == len(keys), "Duplicate entries violate committed rules")
    require(type(c.get("removeWinners")) is bool and integer(c.get("winnersTarget"), 1, 1000), "Invalid committed rules")
    require(not c["removeWinners"] or c["winnersTarget"] <= len(entries), "Winner target exceeds available entries")
    require(not c["removeWinners"] or len("\n".join(entries).encode("utf-8")) * c["winnersTarget"] <= 128 * 1024 * 1024, "Draw plan exceeds verification work limit; use fewer or shorter entries, or fewer winners")
    draws = a.get("draws")
    require(isinstance(draws, list) and len(draws) <= c["winnersTarget"] and len(draws) <= 1000, "Draw count exceeds committed target")
    require(not c["removeWinners"] or len(draws) <= len(entries), "Draw count exceeds available pool")
    for field in ("value", "note"):
        value = entropy.get(field)
        require(string(value, 2048) and value.strip(WHITESPACE) == value, "Invalid entropy " + field)
    require(string(a["session"].get("id"), 128) and a["session"]["id"], "Invalid session ID")
    created, committed = timestamp(a["session"].get("createdAt")), timestamp(c.get("committedAt"))
    generated, revealed = timestamp(a.get("generatedAt")), timestamp(a["reveal"].get("revealedAt"))
    require(created <= committed <= generated and committed <= revealed, "Invalid session chronology")
    require("enteredAt" in entropy and "lockedAt" in entropy, "Missing entropy timestamps")
    entered = None if entropy["enteredAt"] is None else timestamp(entropy["enteredAt"])
    locked = None if entropy["lockedAt"] is None else timestamp(entropy["lockedAt"])
    require(entered is None or created <= entered <= generated, "Invalid entropy entry time")
    require(not entropy["value"] or entered is not None, "Missing entropy entry time")
    if draws:
        require(isinstance(draws[0], dict), "Invalid draw record")
        first = timestamp(draws[0].get("at"))
        require(locked is not None and committed <= locked <= first and (entered is None or entered <= locked), "Entropy must be fixed before the first draw")
    else:
        require(locked is None, "Entropy locked without a draw")
    events = a.get("events")
    require(isinstance(events, list) and len(events) <= 20000, "Invalid event log")
    for event in events:
        require(isinstance(event, dict) and string(event.get("type"), 128), "Invalid event")
        timestamp(event.get("at"))
    if "integrity" in a:
        require(isinstance(a["integrity"], dict) and fingerprint(a["integrity"].get("sha256")), "Invalid integrity fingerprint")

    list_hash = digest("\n".join(entries).encode("utf-8"))
    require(list_hash == a["list"]["sha256"] == c["listSha256"], "List fingerprint mismatch")
    seed = bytes.fromhex(a["reveal"]["seed"])
    require(digest(seed) == c["seedSha256"], "Seed commitment mismatch")
    taken, previous, results = set(), committed, []
    full_pool = list(range(len(entries)))
    for n, d in enumerate(draws, 1):
        require(isinstance(d, dict) and type(d.get("n")) is int and d["n"] == n, "Draws must be numbered consecutively from 1")
        at = timestamp(d.get("at"))
        require(previous <= at <= generated and at <= revealed, "Invalid draw chronology")
        previous = at
        require(string(d.get("winner"), 512) and fingerprint(d.get("poolSha256")) and fingerprint(d.get("hmac")), "Invalid draw fields")
        for field, low, high in (("poolSize", 1, len(entries)), ("ctr", 0, 9999), ("uint32", 0, 2 ** 32 - 1), ("poolIndex", 0, len(entries) - 1), ("entryIndex", 0, len(entries) - 1)):
            require(integer(d.get(field), low, high), "Invalid " + field)
        anim = d.get("anim")
        require(isinstance(anim, dict) and integer(anim.get("durationMs"), 3000, 15000) and integer(anim.get("turns"), 6, 9), "Invalid animation")
        frac = anim.get("frac")
        require(type(frac) in (int, float) and math.isfinite(frac) and 0.18 <= frac <= 0.82, "Invalid animation fraction")
        pool = [i for i in full_pool if i not in taken] if c["removeWinners"] else full_pool
        require(pool, "Eligible pool exhausted")
        limit = (2 ** 32 // len(pool)) * len(pool)
        for ctr in range(10000):
            message = f"fairspin/v1|list:{list_hash}|entropy:{entropy['value']}|draw:{n}|ctr:{ctr}".encode("utf-8")
            h = hmac.new(seed, message, hashlib.sha256).digest()
            r = int.from_bytes(h[:4], "big")
            if r < limit:
                break
        else:
            raise ValueError("Rejection sampling exhausted")
        index = r % len(pool)
        winner_index = pool[index]
        expected_frac = float(format(0.18 + 0.64 * (int.from_bytes(h[4:6], "big") / 65535), ".6f"))
        pool_hash = digest("\n".join(entries[i] for i in pool).encode("utf-8")) if c["removeWinners"] else list_hash
        expected = {"poolSize": len(pool), "poolSha256": pool_hash, "ctr": ctr, "uint32": r, "hmac": h.hex(), "poolIndex": index, "entryIndex": winner_index, "winner": entries[winner_index]}
        for field, value in expected.items():
            require(d[field] == value, f"Draw {n}: {field} mismatch")
        require(anim["turns"] == 6 + h[6] % 4 and frac == expected_frac, f"Draw {n}: animation mismatch")
        taken.add(winner_index)
        results.append((n, entries[winner_index]))
    return results


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON property: " + key)
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError("Invalid JSON number: " + value)


def main(argv):
    if len(argv) != 2:
        print("Usage: python3 verify.py fairspin-SESSION-audit.json", file=sys.stderr)
        return 2
    try:
        with open(argv[1], "rb") as handle:
            raw = handle.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "Audit exceeds 10 MiB limit")
        audit = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique_object, parse_constant=invalid_constant)
        results = verify(audit)
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError) as error:
        print("FAILED: " + str(error), file=sys.stderr)
        return 1
    for n, winner in results:
        print(f"Draw {n}: OK -> {json.dumps(winner, ensure_ascii=True)}")
    print(f"Verified {len(results)} draw(s) and the commitment calculations.")
    print("Whole-file checksum not checked; use the browser verifier for that check.")
    print("Compare commitments and rules with the public post. Local timestamps do not prove publication.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
