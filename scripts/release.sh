#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh <patch|minor|major>
# Bumps all package versions, commits, tags, pushes, and creates a GitHub release.

BUMP="${1:-}"

if [[ -z "$BUMP" ]] || [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: ./scripts/release.sh <patch|minor|major>"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Read current version from core package
CURRENT=$(node -p "require('./packages/core/package.json').version")
echo "Current version: $CURRENT"

# Compute next version
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac
NEXT="$MAJOR.$MINOR.$PATCH"
echo "Next version:    $NEXT"

# Update all package.json files
for pkg in packages/core packages/react packages/vue; do
  node -e "
    const fs = require('fs');
    const path = './$pkg/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$NEXT';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  Updated $pkg → $NEXT"
done

# Update root package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  pkg.version = '$NEXT';
  fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "  Updated root → $NEXT"

# Commit and tag
git add package.json packages/*/package.json
git commit -m "release: v$NEXT"
git tag "v$NEXT"

echo ""
echo "Created commit and tag v$NEXT"
echo ""
echo "Next steps:"
echo "  git push && git push --tags"
echo "  gh release create v$NEXT --generate-notes"
