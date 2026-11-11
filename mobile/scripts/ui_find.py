#!/usr/bin/env python3
"""uiautomator 덤프(XML)에서 글자·설명(content-desc)으로 노드를 찾아 가운데 좌표를 찍는다 — emu.sh tapon/has 가 쓴다.
    python3 ui_find.py <dump.xml> "<글자>" [--exact] [--nth N]
WebView 안의 버튼·링크도 접근성 노드로 나온다(글자 또는 content-desc). 못 찾으면 종료 코드 1."""
import re, sys
import xml.etree.ElementTree as ET

def main():
    path, needle = sys.argv[1], sys.argv[2]
    exact = '--exact' in sys.argv
    nth = int(sys.argv[sys.argv.index('--nth') + 1]) if '--nth' in sys.argv else 0
    raw = open(path, encoding='utf-8', errors='replace').read()
    raw = raw[raw.find('<?xml'):] if '<?xml' in raw else raw
    raw = raw[: raw.rfind('</hierarchy>') + len('</hierarchy>')]
    hits = []
    for n in ET.fromstring(raw).iter('node'):
        for key in ('text', 'content-desc'):
            v = (n.get(key) or '').strip()
            if v and ((v == needle) if exact else (needle in v)):
                m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
                if m:
                    x1, y1, x2, y2 = map(int, m.groups())
                    if x2 > x1 and y2 > y1:
                        hits.append(((x1 + x2) // 2, (y1 + y2) // 2, v))
                break
    if len(hits) <= nth:
        sys.exit(1)
    x, y, v = hits[nth]
    print(x, y, v)

if __name__ == '__main__':
    main()
