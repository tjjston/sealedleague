from pydantic import BaseModel, Field


class LeagueSearchCard(BaseModel):
    card_id: str
    set_code: str
    number: str
    name: str
    character_variant: str | None = None
    type: str
    rarity: str
    aspects: list[str] = Field(default_factory=list)
    traits: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    arenas: list[str] = Field(default_factory=list)
    rules_text: str = ""
    image_url: str | None = None
    variant_type: str | None = None
    cost: int | None = None
    power: int | None = None
    hp: int | None = None
    unique: bool = False


class LeagueSearchCards(BaseModel):
    count: int
    cards: list[LeagueSearchCard]


class LeagueDraftSimulationBody(BaseModel):
    set_codes: list[str] = Field(default_factory=list)
    pack_count: int = Field(default=6, ge=1, le=36)


class LeagueDraftPack(BaseModel):
    pack_index: int
    commons: list[LeagueSearchCard] = Field(default_factory=list)
    uncommons: list[LeagueSearchCard] = Field(default_factory=list)
    rare_or_legendary: LeagueSearchCard
    leader: LeagueSearchCard
    base: LeagueSearchCard
    wildcard: LeagueSearchCard


class LeagueDraftSimulation(BaseModel):
    set_codes: list[str] = Field(default_factory=list)
    pack_count: int
    leaders: list[LeagueSearchCard] = Field(default_factory=list)
    bases: list[LeagueSearchCard] = Field(default_factory=list)
    packs: list[LeagueDraftPack] = Field(default_factory=list)
    non_leader_base_pool: list[LeagueSearchCard] = Field(default_factory=list)
