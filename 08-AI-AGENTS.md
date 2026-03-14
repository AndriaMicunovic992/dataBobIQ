# AI Agent Architecture

## Two Agents, Clear Separation

The architecture retains two distinct AI personas, each with a focused tool set and system prompt. The key change from the current architecture: agents receive **schema metadata and aggregated summaries**, never raw data. All data access happens through tool calls that execute DuckDB queries server-side.

### Data Understanding Agent
- **Active on:** Data Model tab
- **Purpose:** Learn about the user's data structure, save business knowledge
- **Tools:** `query_data`, `list_dimension_values`, `save_knowledge`, `list_knowledge`, `suggest_mapping`
- **Model:** Claude Sonnet (multi-turn, tool-use)

### Scenario Agent
- **Active on:** Actuals tab, Scenarios tab
- **Purpose:** Answer data questions, create/modify scenarios, compute KPIs
- **Tools:** `query_data`, `list_dimension_values`, `create_scenario`, `add_scenario_rule`, `list_scenarios`, `compare_scenarios`, `get_kpi_values`, `list_knowledge`
- **Model:** Claude Sonnet (multi-turn, tool-use)

## Context Window Design

The system prompt includes a compact XML context block (target: <4000 tokens) built from the semantic layer. This context tells the AI what it can query without sending any actual data:

```xml
<data_context>
  <dataset name="GL Entries 2024-2025" fact_type="financial_transactions" rows="487000">
    <dimensions>
      <dim name="account_group" source="dim_account" cardinality="12"
           values="Personnel Costs, Material Costs, Revenue, Rent, ..." />
      <dim name="fiscal_period" source="dim_date" cardinality="24"
           values="2024-01, 2024-02, ..., 2025-12" />
      <dim name="cost_center" source="dim_cost_center" cardinality="8"
           values="KST 1200, KST 1300, ..." />
      <dim name="entity" source="dim_entity" cardinality="3"
           values="Company A, Company B, Company C" />
    </dimensions>
    <measures>
      <measure name="net_amount" type="currency" stats="min=-890000 max=1200000 sum=-45000000" />
    </measures>
    <kpis>
      <kpi name="revenue" label="Revenue" value="12500000" />
      <kpi name="gross_profit" label="Gross Profit" value="4800000" />
      <kpi name="ebitda" label="EBITDA" value="2100000" />
    </kpis>
  </dataset>
  
  <custom_dataset name="Tempo Hours Q1-Q4 2025" fact_type="custom" rows="12400">
    <dimensions>
      <dim name="worker" cardinality="45" />
      <dim name="project" cardinality="12" />
      <dim name="activity_type" cardinality="6" />
    </dimensions>
    <measures>
      <measure name="hours" type="decimal" stats="min=0.5 max=12 sum=98000" />
      <measure name="billable_hours" type="decimal" stats="sum=72000" />
    </measures>
  </custom_dataset>
  
  <knowledge>
    <definition term="personnel costs" maps_to="account_group = 'Personnel Costs'" />
    <definition term="COGS" maps_to="p_and_l_line = 'COGS'" />
    <relationship from="GL Entries" to="Tempo Hours" via="cost_center" />
  </knowledge>
  
  <scenarios count="2">
    <scenario id="sc_001" name="Revenue +10%" rules="2" base_year="2025" />
    <scenario id="sc_002" name="Cost Reduction" rules="5" base_year="2025" />
  </scenarios>
</data_context>
```

## Tool Definitions

### Core Tools (Both Agents)

**`query_data`** — Server-side grouped aggregation via DuckDB
```json
{
  "name": "query_data",
  "description": "Query any dataset with grouping and aggregation. Returns max 50 rows.",
  "input_schema": {
    "properties": {
      "dataset_name": { "type": "string", "description": "Dataset to query" },
      "group_by": { "type": "array", "items": { "type": "string" } },
      "value_column": { "type": "string" },
      "aggregation": { "type": "string", "enum": ["sum", "avg", "min", "max", "count"] },
      "filters": { "type": "object" }
    }
  }
}
```

**`list_dimension_values`** — Look up unique values for filter building
```json
{
  "name": "list_dimension_values",
  "description": "Get unique values for a dimension column. Use to verify filters.",
  "input_schema": {
    "properties": {
      "dataset_name": { "type": "string" },
      "column_name": { "type": "string" },
      "search": { "type": "string", "description": "Substring filter" }
    }
  }
}
```

### Scenario Agent Tools

**`create_scenario`** — Create a new scenario with rules
```json
{
  "name": "create_scenario",
  "description": "Create a scenario with one or more rules. Always submit ALL rules at once.",
  "input_schema": {
    "properties": {
      "name": { "type": "string" },
      "base_year": { "type": "integer" },
      "rules": {
        "type": "array",
        "items": {
          "properties": {
            "name": { "type": "string" },
            "type": { "type": "string", "enum": ["multiplier", "offset"] },
            "factor": { "type": "number" },
            "offset": { "type": "number" },
            "filters": { "type": "object" },
            "period_from": { "type": "string" },
            "period_to": { "type": "string" },
            "distribution": { "type": "string", "enum": ["proportional", "equal"] }
          }
        }
      }
    }
  }
}
```

**`compare_scenarios`** — Get variance between actuals and one or more scenarios
```json
{
  "name": "compare_scenarios",
  "description": "Compare actuals vs scenarios. Returns variance by dimension.",
  "input_schema": {
    "properties": {
      "scenario_ids": { "type": "array", "items": { "type": "string" } },
      "group_by": { "type": "array", "items": { "type": "string" } },
      "value_column": { "type": "string" }
    }
  }
}
```

**`get_kpi_values`** — Evaluate KPIs with optional scenario comparison
```json
{
  "name": "get_kpi_values",
  "description": "Get KPI values, optionally comparing actuals vs scenario.",
  "input_schema": {
    "properties": {
      "kpi_ids": { "type": "array", "items": { "type": "string" } },
      "group_by": { "type": "array", "items": { "type": "string" } },
      "scenario_id": { "type": "string" }
    }
  }
}
```

### Data Understanding Agent Tools

**`save_knowledge`** — Persist business context
```json
{
  "name": "save_knowledge",
  "description": "Save domain knowledge permanently. Types: relationship, calculation, transformation, definition, note.",
  "input_schema": {
    "properties": {
      "entry_type": { "type": "string" },
      "content": { "type": "object" },
      "plain_text": { "type": "string" }
    }
  }
}
```

**`suggest_mapping`** — Propose column mapping for a new upload
```json
{
  "name": "suggest_mapping",
  "description": "Suggest how raw upload columns map to the canonical schema.",
  "input_schema": {
    "properties": {
      "dataset_id": { "type": "string" },
      "mappings": {
        "type": "array",
        "items": {
          "properties": {
            "source_column": { "type": "string" },
            "target_field": { "type": "string" },
            "confidence": { "type": "string" }
          }
        }
      }
    }
  }
}
```

## Tool Count Discipline

Keep the total tool count **under 10 per agent**. Research shows LLM performance degrades when presented with more than 20 tools. Clear, well-documented tools with distinct purposes yield better AI behavior than a sprawling registry.

| Agent | Tool Count | Tools |
|-------|-----------|-------|
| Data Understanding | 5 | query_data, list_dimension_values, save_knowledge, list_knowledge, suggest_mapping |
| Scenario | 8 | query_data, list_dimension_values, create_scenario, add_scenario_rule, list_scenarios, compare_scenarios, get_kpi_values, list_knowledge |

## Human-in-the-Loop Pattern

The AI proposes, the user disposes:

1. User asks a what-if question
2. AI queries current state via `query_data` and `get_kpi_values`
3. AI proposes scenario rules with an impact preview
4. **User reviews and approves** (or modifies)
5. AI calls `create_scenario` or `add_scenario_rule`
6. Engine applies rules, computes overrides
7. AI calls `compare_scenarios` to show the result

The critical point: step 4 is explicit. The AI never modifies data or creates scenarios without the user seeing and approving the plan first. This matches the pattern used by financial planning tools like Pigment and Runway.
