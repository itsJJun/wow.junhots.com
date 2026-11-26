"""Leveling rotations (MythicSim APL JSON) built from short priority lists. Spell ids are top ranks: the engine
casts the highest rank the character's level has learned and skips spells it doesn't know (talents not taken yet)."""

def S(i): return {'spellId': i}
def cast(i, cond=None):
    a = {'action': {'castSpell': {'spellId': S(i) if isinstance(i, int) else i}}}
    if cond: a['action']['condition'] = cond
    return a
def const(v): return {'const': {'val': v}}
def cmp(op, lhs, v): return {'cmp': {'op': op, 'lhs': lhs, 'rhs': const(v)}}
def AND(*v): return {'and': {'vals': list(v)}}
def OR(*v): return {'or': {'vals': list(v)}}
def NOT(v): return {'not': {'val': v}}
def dot_on(i): return {'dotIsActive': {'spellId': S(i)}}
def aura_on(i): return {'auraIsActive': {'auraId': S(i)}}
def debuff_on(i): return {'auraIsActive': {'auraId': S(i), 'sourceUnit': {'type': 'CurrentTarget'}}}
def rem_ge(s): return cmp('OpGe', {'remainingTime': {}}, s)
def rage_ge(n): return cmp('OpGe', {'currentRage': {}}, str(n))
def energy_ge(n): return cmp('OpGe', {'currentEnergy': {}}, str(n))
def cp_ge(n): return cmp('OpGe', {'currentComboPoints': {}}, str(n))
def mana_ge(p): return cmp('OpGe', {'currentManaPercent': {}}, p)
def mana_lt(p): return cmp('OpLt', {'currentManaPercent': {}}, p)
def hp_lt(p): return cmp('OpLt', {'currentHealthPercent': {}}, p)
def execute(): return {'isExecutePhase': {'threshold': 'E20'}}
def apl(prio, prepull=()):
    return {'type': 'TypeAPL', 'priorityList': list(prio),
            'prepullActions': [{'action': {'castSpell': {'spellId': S(i)}}, 'doAtValue': const(t)} for i, t in prepull]}

# ---- Warrior (Battle Stance questing) ----
BSHOUT, REND, OP, MS, BT, HS, EXE, SUNDER, REV, SSLAM, BLOODRAGE, TC = 25289, 11574, 11585, 21553, 23894, 25286, 20662, 11597, 25288, 23925, 2687, 11581
WARRIOR_DPS = apl([
    cast(BSHOUT, NOT(aura_on(BSHOUT))),
    cast(BLOODRAGE),
    cast(EXE, execute()),
    cast(MS), cast(BT),
    cast(OP),
    cast(REND, AND(NOT(dot_on(REND)), rem_ge('9s'), NOT(execute()))),
    cast(HS, rage_ge(40)),
], prepull=[(BSHOUT, '-2s')])
WARRIOR_PROT = apl([
    cast(BSHOUT, NOT(aura_on(BSHOUT))),
    cast(BLOODRAGE),
    cast(SSLAM), cast(REV),
    cast(EXE, execute()),
    cast(REND, AND(NOT(dot_on(REND)), rem_ge('9s'))),
    cast(HS, rage_ge(40)),
    cast(SUNDER, rage_ge(30)),
], prepull=[(BSHOUT, '-2s')])

# ---- Rogue (no Backstab: the mob faces you while questing solo) ----
SS, EVIS, SND, HEMO, RUPTURE = 11294, 31016, 6774, 17348, 11275
def rogue(filler):
    return apl([
        cast(SND, AND(NOT(aura_on(SND)), cp_ge(2), rem_ge('8s'))),
        cast(EVIS, cp_ge(5)),
        cast(EVIS, AND(cp_ge(3), {'cmp': {'op': 'OpLt', 'lhs': {'remainingTime': {}}, 'rhs': const('4s')}})),
        cast(filler), cast(SS),   # Sinister Strike until the filler talent is learned
    ])
ROGUE_SS = rogue(SS)
ROGUE_HEMO = rogue(HEMO)

# ---- Caster helpers ----
SWP, MB, MF, SMITE, HF, PWS = 10894, 10947, 18807, 10934, 15261, 10901
PRIEST_SHADOW = apl([
    cast(SWP, AND(NOT(dot_on(SWP)), rem_ge('9s'))),
    cast(MB), cast(MF), cast(SMITE),
], prepull=[(MB, '-1.5s')])
PRIEST_SMITE = apl([
    cast(SWP, AND(NOT(dot_on(SWP)), rem_ge('9s'))),
    cast(HF, rem_ge('6s')), cast(MB), cast(SMITE),
], prepull=[(SMITE, '-2.5s')])

FROSTBOLT, FIREBALL, FIREBLAST, AM, ARCBLAST, SCORCH = 25304, 25306, 10199, 25345, 1261160, 10207
MAGE_FROST = apl([cast(FIREBLAST, NOT(rem_ge('2s'))), cast(FROSTBOLT), cast(FIREBLAST)], prepull=[(FROSTBOLT, '-3s')])
MAGE_FIRE = apl([cast(FIREBLAST), cast(FIREBALL)], prepull=[(FIREBALL, '-3.5s')])
MAGE_ARCANE = apl([cast(FIREBLAST), cast(AM)], prepull=[(FROSTBOLT, '-3s')])

LB, ES, FS, SSTRIKE = 15208, 10414, 29228, 17364
SHAMAN_ELE = apl([cast(FS, AND(NOT(dot_on(FS)), rem_ge('9s'))), cast(LB), cast(ES)], prepull=[(LB, '-3s')])
SHAMAN_ENH = apl([cast(SSTRIKE), cast(FS, AND(NOT(dot_on(FS)), rem_ge('9s'))), cast(ES, mana_ge('50%'))])

MOONFIRE, WRATH, ISWARM, STARFIRE = 9835, 9912, 24977, 25298
DRUID_CASTER = apl([   # no Insect Swarm: the engine can't sim it on a mob that hits you
    cast(MOONFIRE, AND(NOT(dot_on(MOONFIRE)), rem_ge('9s'))),
    cast(WRATH),
], prepull=[(WRATH, '-2s')])
