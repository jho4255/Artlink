#!/usr/bin/env python3
"""FrameIt 골든 레퍼런스 — 손으로 확정한 기하 + 같은 코드로 잰 지표.

**왜 손으로 넣나**: 벽이 벽돌·나무·잎그림자로 제각각이라 자동 검출이 절반은 틀렸고,
특히 **투영 그림자가 조각으로 잡혀** 경계가 십수 px 밀렸다(case_00 오른쪽 16px 실측).
틀린 좌표로 잰 숫자는 없느니만 못하다. 10장뿐이라 손으로 확정하는 게 정확하고 빠르다.

좌표 근거는 각 변의 단면 프로파일을 직접 읽은 것이다(예: case_00 왼쪽 중앙 스캔에서
벽 218 → 살 x338..353 → 어두운 리베이트 x354..373 → 작품 x374부터).

gap = 조각 바깥경계에서 작품까지(살 + 리베이트), rail = 살만.
"""
import json

# case_02(흰 플로터·나무벽)는 조각 경계를 확정하지 못해 제외한다 — 애매한 좌표로 만든
# 목표값은 나중에 우리를 엉뚱한 데로 끌고 간다. case_03/04/07 도 같은 이유(겹침·2점·원형).
GOLD = {
    'case_00': {'rect': [338, 363, 741, 1005], 'gap': 36, 'rail': 16, 'note': '오크 · 흰 석고벽'},
    'case_01': {'rect': [272, 406, 810, 945], 'gap': 29, 'rail': 16, 'note': '금장 · 슬레이트'},
    'case_05': {'rect': [384, 524, 759, 872], 'gap': 26, 'rail': 12, 'note': '오크 플로터 · 흰 벽돌'},
    'case_06': {'rect': [377, 545, 744, 827], 'gap': 21, 'rail': 8, 'note': '오크 플로터 · 회벽'},
    'case_09': {'rect': [412, 544, 668, 799], 'gap': 40, 'rail': 20, 'note': '화이트 · 콘크리트'},
}


def art_of(g):
    x0, y0, x1, y1 = g['rect']
    k = g['gap']
    return [x0 + k, y0 + k, x1 - k, y1 - k]


if __name__ == '__main__':
    import numpy as np
    from PIL import Image, ImageDraw
    import metrics as M
    out = {}
    sheet = Image.new('RGB', (5 * 250, 300), 'white')
    for i, (k, g) in enumerate(sorted(GOLD.items())):
        p = f'cases/{k}/frameit_reference.png'
        art = art_of(g)
        v = M.analyse(p, g['rect'], art, g['rail'])
        out[k] = v
        im = Image.open(p).convert('RGB')
        d = ImageDraw.Draw(im)
        d.rectangle(g['rect'], outline=(255, 40, 40), width=4)
        d.rectangle(art, outline=(0, 235, 255), width=3)
        im.thumbnail((246, 296))
        sheet.paste(im, (i * 250 + 2, 2))
        print(f'{k}  key={v["keyline_spike"]:5.1f} rebate={v["rebate_drop"]:6.1f}/{v["rebate_ratio"]:.2f} '
              f'span={v["rail_span"]:5.1f} turns={v["rail_turns"]:4.1f} dirTB={v["dir_tb"]:+6.1f} '
              f'dirLR={v["dir_lr"]:5.1f} drop={v["contact_drop"]:6.1f} rec={v["recover_pct"]:5.1f}%  {g["note"]}')
    sheet.save('golden_overlay.png')
    json.dump(out, open('golden_metrics.json', 'w'), indent=1)
    print()
    for m in ('keyline_spike', 'rebate_drop', 'rebate_ratio', 'rail_span', 'rail_turns',
              'dir_tb', 'dir_lr', 'contact_drop', 'recover_pct'):
        v = [x[m] for x in out.values()]
        print(f'  {m:14s} min={min(v):8.1f}  median={np.median(v):8.1f}  max={max(v):8.1f}')
