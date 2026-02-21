from bracket.utils.league_cards import filter_cards_for_deckbuilding, simulate_sealed_draft


def test_filter_cards_for_deckbuilding_by_traits_keywords_and_query() -> None:
    cards = [
        {
            "Set": "SOR",
            "Number": "001",
            "Name": "Luke Skywalker",
            "Type": "Unit",
            "Rarity": "Legendary",
            "Aspects": ["Heroism", "Aggression"],
            "Traits": ["Rebel", "Force"],
            "Keywords": ["Sentinel"],
            "Arenas": ["Ground"],
            "FrontText": "When played, attack an enemy unit.",
            "Unique": True,
        },
        {
            "Set": "SHD",
            "Number": "099",
            "Name": "Outer Rim Smuggler",
            "Type": "Unit",
            "Rarity": "Common",
            "Aspects": ["Cunning"],
            "Traits": ["Underworld"],
            "Keywords": ["Raid"],
            "Arenas": ["Ground"],
            "FrontText": "Gain 1 resource.",
            "Unique": False,
        },
    ]

    filtered = filter_cards_for_deckbuilding(
        cards,
        query="enemy unit",
        traits=["rebel"],
        keywords=["sentinel"],
        aspects=["heroism"],
        unique=True,
    )

    assert len(filtered) == 1
    assert filtered[0]["card_id"] == "sor-001"
    assert filtered[0]["name"] == "Luke Skywalker"


def test_filter_cards_for_deckbuilding_uses_subset_logic_for_multi_value_filters() -> None:
    cards = [
        {
            "Set": "TWI",
            "Number": "010",
            "Name": "Clone Commander",
            "Type": "Unit",
            "Rarity": "Rare",
            "Aspects": ["Vigilance", "Command"],
            "Traits": ["Republic", "Clone"],
            "Keywords": ["Grit", "Sentinel"],
            "Arenas": ["Ground"],
            "FrontText": "",
            "Unique": False,
        },
        {
            "Set": "TWI",
            "Number": "011",
            "Name": "Training Cadet",
            "Type": "Unit",
            "Rarity": "Common",
            "Aspects": ["Vigilance"],
            "Traits": ["Republic"],
            "Keywords": ["Grit"],
            "Arenas": ["Ground"],
            "FrontText": "",
            "Unique": False,
        },
    ]

    filtered = filter_cards_for_deckbuilding(
        cards,
        aspects=["vigilance", "command"],
        traits=["clone", "republic"],
        keywords=["grit", "sentinel"],
        set_codes=["twi"],
    )
    assert [card["card_id"] for card in filtered] == ["twi-010"]


def test_simulate_sealed_draft_excludes_special_rarity_cards_from_booster_slots() -> None:
    cards = [
        {"Set": "SOR", "Number": "001", "Name": "Standard Leader", "Type": "Leader", "Rarity": "Rare"},
        {
            "Set": "SOR",
            "Number": "002",
            "Name": "Darth Vader - Dark Lord of the Sith",
            "Type": "Leader",
            "Rarity": "Special",
        },
        {"Set": "SOR", "Number": "003", "Name": "Standard Base", "Type": "Base", "Rarity": "Common"},
        {"Set": "SOR", "Number": "004", "Name": "Promo Base", "Type": "Base", "Rarity": "Special"},
        {"Set": "SOR", "Number": "005", "Name": "Common Unit", "Type": "Unit", "Rarity": "Common"},
        {"Set": "SOR", "Number": "006", "Name": "Uncommon Unit", "Type": "Unit", "Rarity": "Uncommon"},
        {"Set": "SOR", "Number": "007", "Name": "Rare Unit", "Type": "Unit", "Rarity": "Rare"},
        {"Set": "SOR", "Number": "008", "Name": "Special Unit", "Type": "Unit", "Rarity": "Special"},
    ]

    simulation = simulate_sealed_draft(cards, set_codes=["sor"], pack_count=8)

    assert all(card["rarity"].lower() != "special" for card in simulation["leaders"])
    assert all(card["rarity"].lower() != "special" for card in simulation["bases"])
    assert all(card["rarity"].lower() != "special" for card in simulation["non_leader_base_pool"])
    assert all(pack["leader"]["rarity"].lower() != "special" for pack in simulation["packs"])
    assert all(pack["base"]["rarity"].lower() != "special" for pack in simulation["packs"])
    assert all(pack["wildcard"]["rarity"].lower() != "special" for pack in simulation["packs"])


def test_simulate_sealed_draft_falls_back_to_non_special_leaders_when_set_is_special_only() -> None:
    cards = [
        {"Set": "IBH", "Number": "001", "Name": "Prerelease Leader", "Type": "Leader", "Rarity": "Special"},
        {"Set": "IBH", "Number": "002", "Name": "Prerelease Base", "Type": "Base", "Rarity": "Special"},
        {"Set": "IBH", "Number": "003", "Name": "Prerelease Unit", "Type": "Unit", "Rarity": "Special"},
        {"Set": "SOR", "Number": "010", "Name": "Fallback Leader", "Type": "Leader", "Rarity": "Rare"},
        {"Set": "SOR", "Number": "011", "Name": "Fallback Base", "Type": "Base", "Rarity": "Common"},
        {"Set": "SOR", "Number": "012", "Name": "Fallback Common", "Type": "Unit", "Rarity": "Common"},
        {"Set": "SOR", "Number": "013", "Name": "Fallback Uncommon", "Type": "Unit", "Rarity": "Uncommon"},
        {"Set": "SOR", "Number": "014", "Name": "Fallback Rare", "Type": "Unit", "Rarity": "Rare"},
    ]

    simulation = simulate_sealed_draft(cards, set_codes=["ibh"], pack_count=2)

    assert all(card["rarity"].lower() != "special" for card in simulation["leaders"])
    assert all(card["rarity"].lower() != "special" for card in simulation["bases"])
