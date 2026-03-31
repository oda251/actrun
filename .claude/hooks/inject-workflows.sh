#!/bin/bash
# UserPromptSubmit hook — injects available workflows with required inputs.
# Uses `actrun inspect` to resolve inputs from skill definitions.

WORKFLOWS=""

for dir in "$HOME/.claude/workflows" ".claude/workflows"; do
  if [ -d "$dir" ]; then
    while IFS= read -r f; do
      inspect=$(actrun inspect "$f" --skills-dir ".claude/skills" 2>/dev/null)
      if [ -n "$inspect" ]; then
        name=$(echo "$inspect" | jq -r '.name')
        path=$(echo "$inspect" | jq -r '.path')
        inputs=$(echo "$inspect" | jq -r '.required_inputs[] | "\(.key)[\(.type)]"' | tr '\n' ', ' | sed 's/,$//')
        if [ -n "$inputs" ]; then
          WORKFLOWS="$WORKFLOWS\n- $path: $name (inputs: $inputs)"
        else
          WORKFLOWS="$WORKFLOWS\n- $path: $name"
        fi
      fi
    done < <(find "$dir" -name "*.yml" -type f 2>/dev/null | sort)
  fi
done

if [ -n "$WORKFLOWS" ]; then
  CONTEXT="利用可能なワークフロー:$WORKFLOWS"
  ESCAPED=$(echo -e "$CONTEXT" | jq -Rs .)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":$ESCAPED}}"
fi

exit 0
