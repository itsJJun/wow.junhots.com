"""Class/spec configs for runner.py: template, race, talents (51-point, filled main tree first while leveling), rotation."""
import os
import json, copy
import apls

REPO = os.environ['MSE_ENGINE'] + '/'
LAYOUT = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layouts.json')))
SPELLS = {}
for l in open(REPO + 'data/spells.jsonl'):
    d = json.loads(l); SPELLS[d['ID']] = d
LONG_CD = {1259799, 1259813, 20572, 26296, 26297, 20594, 7744, 20549, 20554, 26635, 1719, 12292, 12328, 18499, 13750, 13877, 3045,
           19574, 12042, 12472, 11129, 12043, 10060, 14751, 16166, 17116, 16188, 29166, 20216, 31884, 1322605}

def strip_cds(rot):
    """Leveling: no long cooldowns, potions, trinkets or racials every pull (a short fight would use them every kill)."""
    r = copy.deepcopy(rot)
    def bad(x):
        s = json.dumps(x['action'])
        if 'autocastOtherCooldowns' in s or 'OtherActionPotion' in s or '"itemId"' in s: return True
        a = x['action'].get('castSpell', {}).get('spellId', {})
        i = a.get('spellId')
        if i in LONG_CD: return True
        sp = SPELLS.get(i) or {}
        return max(sp.get('CooldownMs') or 0, sp.get('CategoryCooldownMs') or 0) >= 60000
    r['priorityList'] = [x for x in r['priorityList'] if not bad(x)]
    r['prepullActions'] = [x for x in r.get('prepullActions', []) if not bad(x)]
    return r

def tapl(name):
    return strip_cds(json.load(open(REPO + 'fixtures/levels/' + name + '.request.json'))['raid']['parties'][0]['players'][0]['rotation'])

def build(cls, picks):
    """Talent string from {tree index: [(talent, ranks), ...]} using the engine's Forever layout for the class."""
    trees = [v for k, v in LAYOUT.items() if k.startswith(cls + ':FOREVER_') or (cls == 'warrior' and k == 'warrior:PROTECTION')
             or (cls == 'shaman' and k.startswith('shaman:'))]
    out = []
    for ti, tree in enumerate(trees):
        names = [n for n, _ in tree]; mx = dict(tree); want = dict(picks.get(ti, []))
        for n in want: assert n in mx and want[n] <= mx[n], (cls, n)
        out.append(''.join(str(want.get(n, 0)) for n in names).rstrip('0'))
    return '-'.join(out).rstrip('-')

MELEE_SITE = {'mhitP': ['hitPct'], 'mcritP': ['critPct'], 'ap': ['atkpwr'], 'rap': ['rgdatkpwr'], 'mp5': ['manargn'],
              'sp': ['splpwr', 'spldmg']}
CASTER_SITE = {'sp': ['splpwr', 'spldmg'], 'hitP': ['hitPct'], 'critP': ['critPct'], 'mp5': ['manargn'], 'shadow': ['shasplpwr'],
               'fire': ['firsplpwr'], 'frost': ['frosplpwr'], 'arcane': ['arcsplpwr'], 'nature': ['natsplpwr'], 'holy': ['holsplpwr'],
               'wandDps': ['rangedDps']}
MD = {'str': 10, 'agi': 10, 'ap': 20, 'sta': 30, 'mhitP': 2, 'mcritP': 2, 'armor': 200}
CD = {'sp': 20, 'int': 20, 'spi': 20, 'sta': 30, 'mp5': 10, 'hitP': 2, 'critP': 2, 'armor': 200}

def cfg(cls, spec, ckey, cid, race, tmpl, key, talents, main, rot, phys, wsets, delta, ref, opts=None, **kw):
    c = dict(cls=cls, spec=spec, ckey=ckey, cid=cid, race=race, tmpl=tmpl, opts_key=key, opts=opts or {}, rot=rot, talents=talents,
             main=main, phys=phys, wsets=wsets, delta=dict(delta), ref=ref, site=MELEE_SITE if phys else CASTER_SITE)
    c.update(kw); return c

# ---------------- Warrior ----------------
ARMS = build('warrior', {0: [('improved_heroic_strike', 3), ('improved_rend', 3), ('improved_charge', 2), ('improved_tactical_mastery', 3),
                             ('improved_overpower', 2), ('anger_management', 1), ('deep_wounds', 3), ('two_handed_weapon_specialization', 3),
                             ('impale', 2), ('bloodthrill', 2), ('sweeping_strikes', 1), ('weaponmaster', 5), ('spearing_strike', 1), ('mortal_strike', 1)],
                         1: [('cruelty', 5), ('unbridled_wrath', 5), ('furious_precision', 3), ('blood_craze', 3), ('enrage', 3)]})
FURY = build('warrior', {1: [('cruelty', 5), ('unbridled_wrath', 5), ('furious_precision', 3), ('blood_craze', 3), ('enrage', 5),
                             ('dual_wield_specialization', 5), ('reckless_swings', 1), ('improved_execute', 2), ('death_wish', 1),
                             ('gore_drinker', 2), ('flurry', 3), ('bloodthirst', 1)],
                         0: [('improved_heroic_strike', 3), ('improved_rend', 3), ('improved_tactical_mastery', 3), ('anger_management', 1),
                             ('deep_wounds', 3), ('impale', 2)]})
W = dict(cls='WARRIOR', ckey='ClassWarrior', cid=1, race='RaceOrc', phys=True, delta=MD, ref='ap')
WARRIOR = {
    'arms': cfg(spec='arms', tmpl='arms-warrior-L30', key='dpsWarrior', talents=ARMS, main=0, rot=apls.WARRIOR_DPS, wsets=['2h'],
                opts={'defaultStance': 'WarriorStanceBattle'}, **W),
    'fury': cfg(spec='fury', tmpl='arms-warrior-L30', key='dpsWarrior', talents=FURY, main=1, rot=apls.WARRIOR_DPS, wsets=['dual', '2h'],
                opts={'defaultStance': 'WarriorStanceBattle'}, **W),
    'protection': cfg(spec='protection', tmpl='protection-warrior-L30', key='protectionWarrior', talents='003-0505000501-250033120301021351',
                      main=2, rot=apls.WARRIOR_PROT, wsets=['shield'], opts={'defaultStance': 'WarriorStanceDefensive'}, **W),
}

# ---------------- Rogue ----------------
COMBAT = build('rogue', {1: [('improved_sinister_strike', 2), ('improved_eviscerate', 3), ('lightning_reflexes', 5), ('precision', 3),
                             ('puncturing_wounds', 3), ('dual_wield_specialization', 2), ('weapon_expertise', 2), ('riposte', 1),
                             ('aggression', 3), ('blade_flurry', 1), ('hack_and_slash', 5), ('flash_of_steel', 5), ('adrenaline_rush', 1)],
                         0: [('malice', 5), ('ruthlessness', 3), ('remorseless_attacks', 2), ('lethality', 2)]})
ASSA = build('rogue', {0: [('remorseless_attacks', 2), ('malice', 5), ('ruthlessness', 3), ('improved_slice_and_dice', 3), ('vigor', 2),
                           ('lethality', 2), ('blood_splatter', 1), ('vile_poisons', 5), ('cold_blood', 1), ('improved_poisons', 5),
                           ('relentless_strikes', 5), ('seal_fate', 3), ('venom', 1), ('mutilate', 1)],
                       1: [('improved_sinister_strike', 2), ('improved_eviscerate', 3), ('precision', 3), ('dual_wield_specialization', 2),
                           ('weapon_expertise', 2)]})
SUB = build('rogue', {2: [('setup', 3), ('opportunity', 5), ('dirty_deeds', 2), ('camouflage', 3), ('improved_ambush', 3), ('initiative', 3),
                          ('premeditation', 1), ('serrated_blades', 3), ('ghostly_strike', 1), ('preparation', 1), ('hemorrhage', 1),
                          ('boot_knife', 5), ('death_mark', 1)],
                      0: [('malice', 5), ('ruthlessness', 3), ('remorseless_attacks', 2), ('improved_slice_and_dice', 3), ('lethality', 2),
                          ('vigor', 2), ('blood_splatter', 1), ('cold_blood', 1)]})
R = dict(cls='ROGUE', ckey='ClassRogue', cid=4, race='RaceOrc', tmpl='combat-rogue-L30', key='rogue', phys=True, delta=MD, ref='ap', wsets=['dual'],
         tank_engine=False)
ROGUE = {
    'assassination': cfg(spec='assassination', talents=ASSA, main=0, rot=apls.ROGUE_SS, **R),
    'combat': cfg(spec='combat', talents=COMBAT, main=1, rot=apls.ROGUE_SS, **R),
    'subtlety': cfg(spec='subtlety', talents=SUB, main=2, rot=apls.ROGUE_HEMO, **R),
}

# ---------------- Mage ----------------
FIRE = build('mage', {1: [('improved_fireball', 5), ('incineration', 5), ('ignite', 5), ('flame_throwing', 2), ('impact', 3),
                          ('improved_fire_blast', 2), ('pyroblast', 1), ('improved_scorch', 3), ('heating_up', 1), ('master_of_elements', 3),
                          ('critical_mass', 3), ('blast_wave', 1), ('fire_power', 3), ('combustion', 1)],
                      0: [('arcane_subtlety', 2), ('wand_specialization', 2), ('arcane_concentration', 5), ('arcane_impact', 3), ('magic_absorption', 1)]})
MA = dict(cls='MAGE', ckey='ClassMage', cid=8, race='RaceUndead', tmpl='frost-mage-L20', key='mage', phys=False, ref='sp', wsets=['2h', 'held'], wand=True, tank_engine=False, ranged=True)
MAGE = {
    'arcane': cfg(spec='arcane', talents='050205203100311531-525000012001-003', main=0, rot=apls.MAGE_ARCANE,
                  delta=dict(CD, arcane=20, fire=20, frost=20), **MA),
    'fire': cfg(spec='fire', talents=FIRE, main=1, rot=apls.MAGE_FIRE, delta=dict(CD, fire=20), **MA),
    'frost': cfg(spec='frost', talents='0502052-5-053500030100331251', main=2, rot=apls.MAGE_FROST, delta=dict(CD, frost=20, fire=20), **MA),
}

# ---------------- Priest ----------------
PR = dict(cls='PRIEST', ckey='ClassPriest', cid=5, race='RaceUndead', tmpl='shadow-priest-L30', key='dpsPriest', phys=False, ref='sp',
          wsets=['2h', 'held'], wand=True, ranged=True, pws=True)
PRIEST = {
    'discipline': cfg(spec='discipline', talents='515035031030001031-00505023002-003', main=0, rot=apls.PRIEST_SMITE, delta=dict(CD, holy=20), **PR),
    'holy': cfg(spec='holy', talents='00520101133-33505003030121531', main=1, rot=apls.PRIEST_SMITE, delta=dict(CD, holy=20), **PR),
    'shadow': cfg(spec='shadow', talents='00530500103--53012201241302251', main=2, rot=apls.PRIEST_SHADOW, delta=dict(CD, shadow=20),
                  **dict(PR, tank_engine=False, spirit_tap=True, shadowform=True)),
}

# ---------------- Shaman ----------------
SH = dict(cls='SHAMAN', ckey='ClassShaman', cid=7, race='RaceOrc')
SHR = dict(SH, ranged=True)
SHAMAN = {
    'elemental': cfg(spec='elemental', tmpl='elemental-shaman-L30', key='elementalShaman', talents='5500331020121351-055000001-053', main=0,
                     rot=apls.SHAMAN_ELE, phys=False, wsets=['2h', 'held', 'shield'], delta=dict(CD, nature=20, fire=20), ref='sp', **SHR),
    'enhancement': cfg(spec='enhancement', tmpl='enhancement-shaman-L22-flametongue', key='enhancementShaman',
                       talents='053303102-053030310051002251-03', main=1, rot=tapl('enhancement-shaman-L22-flametongue'), phys=True,
                       wsets=['2h', 'shield'], delta=dict(MD, int=20, sp=20), ref='ap', **SH),
    'restoration': cfg(spec='restoration', tmpl='elemental-shaman-L30', key='elementalShaman', talents='-055-5530500015513151', main=2,
                       rot=apls.SHAMAN_ELE, phys=False, wsets=['held', 'shield', '2h'], delta=dict(CD, nature=20), ref='sp', **SHR),
}

# ---------------- Paladin ----------------
PA = dict(cls='PALADIN', ckey='ClassPaladin', cid=2, race='RaceHuman', tmpl='retribution-paladin-L30', key='retributionPaladin',
          rot=tapl('retribution-paladin-L30'), phys=True, ref='ap')
PALADIN = {
    'holy': cfg(spec='holy', talents='22320215022101251-503200005003', main=0, wsets=['2h', 'shield'], delta=dict(MD, int=20, sp=20, spi=20), **PA),
    'protection': cfg(spec='protection', talents='-05302102313501531-50233000201', main=1, wsets=['shield', '2h'], delta=dict(MD, int=20, sp=20), **PA),
    'retribution': cfg(spec='retribution', talents='050050002-503-05233301001301351', main=2, wsets=['2h'], delta=dict(MD, int=20, sp=20), **PA),
}

# ---------------- Druid ----------------
DR = dict(cls='DRUID', ckey='ClassDruid', cid=11, race='RaceTauren')
DRUID = {
    'balance': cfg(spec='balance', tmpl='balance-druid-L30', key='balanceDruid', talents='5532220115501351--505', main=0, rot=apls.DRUID_CASTER,
                   phys=False, wsets=['2h', 'held'], delta=dict(CD, arcane=20, nature=20), ref='sp', tank_engine=False, ranged=True, **DR),
    'feral': cfg(spec='feral', tmpl='feral-druid-L30', key='feralCatDruid', talents='050022-55000032023012125001-055', main=1,
                 rot=tapl('feral-druid-L30'), phys=True, wsets=['2h'], delta=MD, ref='ap', form_speed=1.0, **DR),
    'bear': cfg(spec='bear', tmpl='feral-bear-druid-L22', key='feralBearDruid', talents='-5503003212310212551-055', main=1,
                rot=tapl('feral-bear-druid-L22'), phys=True, wsets=['2h'], delta=MD, ref='ap', form_speed=2.5, **DR),
    'restoration': cfg(spec='restoration', tmpl='balance-druid-L30', key='balanceDruid', talents='05002001--5050035153113051', main=2,
                       rot=apls.DRUID_CASTER, phys=False, wsets=['2h', 'held'], delta=dict(CD, nature=20), ref='sp', ranged=True, **DR),
}

# ---------------- Hunter ----------------
HU = dict(cls='HUNTER', ckey='ClassHunter', cid=3, race='RaceOrc', tmpl='hunter-L20', key='hunter', rot=tapl('hunter-L20'), phys=True,
          wsets=['2h', 'dual'], delta=dict(MD, rap=20, int=20, spi=20, mp5=10), ref='rap', ranged=True, pet_tanks=lambda L: L >= 10)
HUNTER = {
    'beastmastery': cfg(spec='beastmastery', talents='5320001505101251-00530520014', main=0, **HU),
    'marksmanship': cfg(spec='marksmanship', talents='50032005021-0050552011523051-', main=1, **HU),
    'survival': cfg(spec='survival', talents='5-005005001-530200230250222151', main=2, **HU),
    'survivalmelee': cfg(spec='survivalmelee', talents='5-005005001-530200230250222151', main=2,
                         **dict(HU, ref='ap', ranged=False, player_fields={'distanceFromTarget': 5},
                                rot=strip_cds(json.load(open(REPO + 'fixtures/mage/prepared-v2/production-survival-hunter-melee.request.json'))
                                              ['raid']['parties'][0]['players'][0]['rotation']))),
}

ALL = {'WARRIOR': WARRIOR, 'ROGUE': ROGUE, 'MAGE': MAGE, 'PRIEST': PRIEST, 'SHAMAN': SHAMAN, 'PALADIN': PALADIN, 'DRUID': DRUID, 'HUNTER': HUNTER}
