# Neo4j GRASS Multi-Label Styling

## GRASS Syntax for Multiple Labels

In GRASS, the **colon-separated labels** in Cypher (`Knowledge:CodeAnalysis:Domain`) become **dot-separated** in GRASS selectors:

```grass
node.Knowledge.CodeAnalysis.Domain {
  color: #FF0000;
  diameter: 60px;
  caption: "{name}";
}
```

## How Neo4j Browser Applies Styles to Multi-Label Nodes

From the `graphStyle.js` source code (neo4j-browser 4.0.5):

### Matching Rules

**1. `matches(selector)`** - Checks if ALL rule classes exist in the node's labels:
```javascript
StyleRule.prototype.matches = function(selector) {
  if (this.selector.tag !== selector.tag) return false
  for (let i = 0; i < this.selector.classes.length; i++) {
    const classs = this.selector.classes[i]
    if (classs != null && selector.classes.indexOf(classs) === -1) {
      return false  // Missing a required label
    }
  }
  return true
}
```

**2. `matchesExact(selector)`** - Same as above PLUS requires the **same number of classes**:
```javascript
StyleRule.prototype.matchesExact = function(selector) {
  return (
    this.matches(selector) &&
    this.selector.classes.length === selector.classes.length
  )
}
```

### Precedence Rules from `findRule` and `applyRules`

- First rule that **matches exactly** wins (found via `findRule`)
- If no exact match, styles **cascade** from all matching rules via `applyRules`, with later rules overriding earlier ones
- When a node has labels but no explicit rule, `setDefaultNodeStyling` generates a default using **only the first label** (sorted) via `minimalSelector`

## Example GRASS File with Multi-Label Styling

```grass
/* Default node style */
node {
  diameter: 50px;
  color: #A5ABB6;
  border-width: 2px;
  font-size: 10px;
}

/* Single label */
node.Person {
  color: #F79767;
  caption: "{name}";
}

/* Node with TWO labels (e.g., :Person:Developer) */
node.Person.Developer {
  color: #4C8EDA;
  caption: "{name} ({title})";
}

/* Node with THREE labels (e.g., :Knowledge:CodeAnalysis:Domain) */
node.Knowledge.CodeAnalysis.Domain {
  color: #8DCC93;
  size: 65px;
  caption: "{sourceFile}";
}

/* Partial match - styles any node containing :Knowledge */
node.Knowledge {
  color: #DA7194;
}
```

## Key Takeaways

1. **Selector syntax**: `node.Label1.Label2.Label3` for nodes with multiple labels
2. **Matching is subset-based**: A rule for `node.Knowledge` will match any node that has the `Knowledge` label (including nodes with additional labels)
3. **Exact match wins**: If you define both `node.Knowledge` and `node.Knowledge.CodeAnalysis.Domain`, a node with all three labels will use the exact-match rule
4. **Style cascading**: Non-exact matching rules all apply in order, with later rules overriding earlier ones
