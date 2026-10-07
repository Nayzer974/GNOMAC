#!/usr/bin/env python3
"""Sort the CRITICAL / JS ERROR lines of a GNOME Shell log into
BENIGN SHUTDOWN and REAL BUG.

    journalctl --user -b -o short-iso /usr/bin/gnome-shell | tools/classify-critical.py
    tools/classify-critical.py shell.log

A line is a BENIGN SHUTDOWN when it appears in the last two seconds of the log
(the shell is being torn down and objects are disposed while a callback is
still queued). Everything earlier is a REAL BUG until proven otherwise, and a
line that is of the "already disposed" kind but appears while the shell is
running is reported as REAL BUG too. Nothing is hidden: both lists are printed.
"""
import re
import sys
from collections import Counter
from datetime import datetime

TIME = re.compile(r'(\d{2}):(\d{2}):(\d{2})[.,](\d+)')
BAD = re.compile(r'CRITICAL|JS ERROR|JS WARNING')


def seconds(line):
    m = TIME.search(line)
    if not m:
        return None
    h, mi, s, frac = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(s) + float('0.' + frac)


def main():
    text = open(sys.argv[1], errors='replace').read() if len(sys.argv) > 1 else sys.stdin.read()
    lines = text.splitlines()
    stamps = [t for t in (seconds(l) for l in lines) if t is not None]
    if not stamps:
        print('no timestamps found: cannot tell shutdown from runtime')
        return 1
    end = stamps[-1]
    benign, real = [], []
    for line in lines:
        if not BAD.search(line):
            continue
        t = seconds(line)
        (benign if t is not None and end - t <= 2.0 else real).append(line)
    key = lambda l: re.sub(r'0x[0-9a-f]+|\d+', 'N', l.split(': ', 2)[-1])[:110]
    for title, group in (('BENIGN SHUTDOWN', benign), ('REAL BUG', real)):
        print(f'== {title}: {len(group)}')
        for message, count in Counter(key(l) for l in group).most_common(12):
            print(f'  {count:4d}  {message}')
    return 1 if real else 0


if __name__ == '__main__':
    sys.exit(main())
