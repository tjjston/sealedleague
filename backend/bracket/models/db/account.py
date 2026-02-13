from enum import auto

from bracket.utils.types import EnumAutoStr


class UserAccountType(EnumAutoStr):
    REGULAR = auto()
    ADMIN = auto()
    DEMO = auto()
