#!/usr/bin/env python3
"""Item hover cards (25 Nov, Jun: the hover window everywhere it helps): public/data/items.json for /assets/npc.js.

Built from Gear upgrades' item data (the newest /data/gear-<hash>.bin the gear page uses: Forever's own stats, so
Forever-only items and changed stats are right, unlike Wowhead's classic data). One row per item:
  i[id] = [name, quality, icon, slot, type, required level, [stat lines], weapon "dps|speed" or "", [sources], random bonus 0/1]
  k[name] = id (first item with that name)
Sources: [kind, text, zone] with kind q (quest), d (drop), c (crafted), b (auction house).

Run: python3 scripts/item_data.py   (build_site.py runs it too)
"""
import gzip, json, os, re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(REPO, 'public')

SLOT = {1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands',
        11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Off Hand', 15: 'Ranged', 16: 'Back', 17: 'Two-Hand', 19: 'Tabard',
        20: 'Chest', 21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 25: 'Thrown', 26: 'Ranged', 28: 'Relic'}
ARMOR = {1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield', 7: 'Libram', 8: 'Idol', 9: 'Totem'}
WEAPON = {0: 'Axe', 1: 'Axe', 2: 'Bow', 3: 'Gun', 4: 'Mace', 5: 'Mace', 6: 'Polearm', 7: 'Sword', 8: 'Sword', 10: 'Staff',
          13: 'Fist Weapon', 14: 'Miscellaneous', 15: 'Dagger', 16: 'Thrown', 18: 'Crossbow', 19: 'Wand', 20: 'Fishing Pole'}
# same words as the Gear upgrades page (STN)
STN = {'sta': 'Stamina', 'int': 'Intellect', 'spi': 'Spirit', 'str': 'Strength', 'agi': 'Agility', 'armor': 'Armor', 'armorbonus': 'Bonus Armor',
       'splpwr': 'Spell Power', 'spldmg': 'Spell Damage', 'shasplpwr': 'Shadow Damage', 'firsplpwr': 'Fire Damage', 'frosplpwr': 'Frost Damage',
       'arcsplpwr': 'Arcane Damage', 'natsplpwr': 'Nature Damage', 'holsplpwr': 'Holy Damage', 'splheal': 'Healing', 'critPct': '% Crit',
       'hitPct': '% Hit', 'dodgePct': '% Dodge', 'parryPct': '% Parry', 'blockPct': '% Block', 'block': 'Block Value', 'manargn': 'Mana per 5',
       'healthrgn': 'Health per 5', 'atkpwr': 'Attack Power', 'rgdatkpwr': 'Ranged Attack Power', 'feratkpwr': 'Feral Attack Power',
       'defrtng': 'Defense', 'exprtng': 'Expertise', 'splpen': 'Spell Penetration', 'natres': 'Nature Resistance', 'firres': 'Fire Resistance',
       'frores': 'Frost Resistance', 'shares': 'Shadow Resistance', 'arcres': 'Arcane Resistance'}
ORDER = list(STN)


def num(v):
    return ('%g' % round(v, 1)) if isinstance(v, float) else str(v)


def stat_lines(st):
    out = []
    if st.get('armor'):
        out.append('%s Armor' % num(st['armor']))
    for k in sorted(st, key=lambda k: ORDER.index(k) if k in ORDER else 99):
        if k == 'armor' or not st[k]:
            continue
        lab = STN.get(k, k)
        out.append(('+%s%s' if lab.startswith('%') else '+%s %s') % (num(st[k]), lab))
    return out


def main():
    page = open(os.path.join(PUB, 'gear-upgrades/index.html'), encoding='utf-8').read()
    m = re.search(r'data-src="/data/(gear-[0-9a-f]+\.bin)"', page)
    db = json.loads(gzip.decompress(open(os.path.join(PUB, 'data', m.group(1)), 'rb').read()))
    zones = db.get('zones', {})
    zn = lambda z: zones.get(str(z), '') if z is not None else ''
    items, names = {}, {}
    for x in db['items']:
        typ = ARMOR.get(x['s'], '') if x['c'] == 4 else WEAPON.get(x['s'], '') if x['c'] == 2 else ''
        src = []
        for s in x.get('src', []):
            t = s.get('t')
            if t == 'q':
                src.append(['q', s.get('n', ''), zn(s.get('z')), s.get('sd', 0)])
            elif t == 'd':
                src.append(['d', s.get('npc', ''), zn(s.get('z')), s.get('pct', 0)])
            elif t == 'c':
                src.append(['c', s.get('p', ''), s.get('sk', 0)])
            elif t == 'b':
                src.append(['b'])
        w = x.get('w')
        row = [x['n'], x['q'], x.get('ic', ''), SLOT.get(x['v'], ''), typ, x.get('r', 0), stat_lines(x.get('st') or {}),
               ('%s|%s' % (num(w[0]), num(w[1]))) if w else '', src, 1 if x.get('x') else 0]
        items[str(x['i'])] = row
        names.setdefault(x['n'], x['i'])
    out = {'v': 1, 'i': items, 'k': names}
    path = os.path.join(PUB, 'data/items.json')
    open(path, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print('items.json: %d items, %d KB' % (len(items), os.path.getsize(path) // 1024))


if __name__ == '__main__':
    main()
