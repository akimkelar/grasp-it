# Cypher-Shell Installation on macOS

This guide covers installing `cypher-shell` on macOS via Homebrew.

## Prerequisites

- [Homebrew](https://brew.sh) installed
- Java 21

## Step 1: Install Java 21

```bash
brew install openjdk@21
```

After installation, Homebrew outputs a message with a `ln` command to symlink the JDK. This makes it available to system Java wrappers — no `JAVA_HOME` or shell rc edits needed.

Run the symlink command (replace `$HOMEBREW_PREFIX` with your Homebrew prefix, typically `/opt/homebrew` on Apple Silicon or `/usr/local` on Intel):

```bash
sudo ln -sfn $HOMEBREW_PREFIX/opt/openjdk@21/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-21.jdk
```

## Step 2: Install cypher-shell

```bash
brew install cypher-shell
```

## Step 3: Verify

```bash
cypher-shell --version
```

Expected output:
```
cypher-shell version 2026.05.0
```

## Step 4: Connect to Neo4j

```bash
cypher-shell -u neo4j -p your-password bolt://localhost:7687
```

For Aura databases:
```bash
cypher-shell -u user@database.name -p your-password neo4j+s://XXXXX.databases.neo4j.io
```

## Troubleshooting

### "No Java runtime found"

Verify Java is installed:
```bash
java -version
```

If missing or the link expired, re-link:
```bash
sudo ln -sfn $(brew --prefix)/opt/openjdk@21/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-21.jdk
```

### "Connection refused"

Make sure Neo4j is running (Neo4j Desktop, Aura, or a local `brew install neo4j` instance).
