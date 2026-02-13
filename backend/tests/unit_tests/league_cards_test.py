from bracket.utils.league_cards import filter_cards_for_deckbuilding


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
