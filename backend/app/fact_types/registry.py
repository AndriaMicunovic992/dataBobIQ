from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

_FACT_TYPES_DIR = Path(__file__).parent
_registry: dict[str, FactTypeDefinition] | None = None


@dataclass
class ColumnDef:
    name: str
    type: str
    description: str
    aliases: list[str] = field(default_factory=list)
    shared_dim: str | None = None
    default: str | None = None


@dataclass
class FactTypeDefinition:
    id: str
    grain: str
    core_measures: list[ColumnDef] = field(default_factory=list)
    core_dimensions: list[ColumnDef] = field(default_factory=list)
    expected_measures: list[ColumnDef] = field(default_factory=list)
    expected_dimensions: list[ColumnDef] = field(default_factory=list)
    system_columns: list[ColumnDef] = field(default_factory=list)
    default_kpis: list[dict] = field(default_factory=list)


def _parse_column_defs(items: list[dict]) -> list[ColumnDef]:
    result: list[ColumnDef] = []
    for item in items:
        result.append(
            ColumnDef(
                name=item["name"],
                type=item.get("type", "text"),
                description=item.get("description", ""),
                aliases=item.get("aliases", []),
                shared_dim=item.get("shared_dim"),
                default=item.get("default"),
            )
        )
    return result


def _load_yaml_file(path: Path) -> FactTypeDefinition:
    """Parse a single YAML fact type definition file."""
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    fact_id = raw.get("id", path.stem)
    grain = raw.get("grain", "")

    core = raw.get("core", {})
    expected = raw.get("expected", {})
    system = raw.get("system_columns", [])
    default_kpis = raw.get("default_kpis", [])

    return FactTypeDefinition(
        id=fact_id,
        grain=grain,
        core_measures=_parse_column_defs(core.get("measures", [])),
        core_dimensions=_parse_column_defs(core.get("dimensions", [])),
        expected_measures=_parse_column_defs(expected.get("measures", [])),
        expected_dimensions=_parse_column_defs(expected.get("dimensions", [])),
        system_columns=_parse_column_defs(system),
        default_kpis=default_kpis,
    )


def load_fact_types() -> dict[str, FactTypeDefinition]:
    """Load all YAML files from the fact_types/ directory.

    Results are cached after the first call.
    """
    global _registry
    if _registry is not None:
        return _registry

    _registry = {}
    for yaml_path in _FACT_TYPES_DIR.glob("*.yaml"):
        try:
            ft = _load_yaml_file(yaml_path)
            _registry[ft.id] = ft
            logger.info("Loaded fact type '%s' from %s", ft.id, yaml_path.name)
        except Exception:
            logger.exception("Failed to load fact type from %s", yaml_path)

    logger.info("Fact type registry loaded: %d types", len(_registry))
    return _registry


def get_fact_type(fact_type_id: str) -> FactTypeDefinition | None:
    """Return a specific fact type by ID, or None if not found."""
    registry = load_fact_types()
    return registry.get(fact_type_id)
