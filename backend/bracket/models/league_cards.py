from pydantic import BaseModel, Field


class LeagueSearchCard(BaseModel):
    card_id: str
    set_code: str
    number: str
    name: str
    type: str
    rarity: str
    aspects: list[str] = Field(default_factory=list)
    traits: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    arenas: list[str] = Field(default_factory=list)
    rules_text: str = ""
    cost: int | str | None = None
    power: int | str | None = None
    hp: int | str | None = None
    unique: bool = False


class LeagueSearchCards(BaseModel):
    count: int
    cards: list[LeagueSearchCard]
