<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/actions/typescript-action/workflows/build-test/badge.svg"></a>
</p>

# GitHub Projects Column Mirror

This is a GitHub Action to mirror columns in hierarchically modeled GitHub Projects.

As an example, let's assume a scenario where there are issues used to document both epic and feature level scopes of work, where features belong to epics.

In this scenario, we have two project boards to individually track and give visibility into epics and features individually.  Each project board has the following columns:
- backlog
- active
- done

If individual teams, or individual roles within a team, are only looking at the feature board then it can be hard to tell what epics are actively being worked on.

This action makes this scenario easier by actively mirroring columns across project boards.  We can create an `active epics` column on the feature board that will automatically stay up to date with the `active` column on the epics project board.

## Usage

The action is intended to be run on a cron schedule, see [mirror.yml](./.github/workflows/mirror.yml) for an example.  The linked action workflow also uses the `push` event trigger for testing purposes only, and is not generally recommended for use.

```
on:
  schedule:
    - cron: '*/5 * * * *' # 5 minutes is the smallest frequency available to actions
jobs:
  mirror_column:
    runs-on: ubuntu-latest
    steps:
    - uses: jonabc/linked-project-columns@v1
      with:
        source_column_id: <column node id>
        target_column_id: <column node id>
        github_token: ${{ secrets.MIRROR_SECRET_PAT }} # can be secrets.GITHUB_TOKEN, see below
```

### Added notice card

The action will add a notice to the top of the target project column, identifying the source project column and notifying users that the column is automatically managed.

### Required permissions

The `${{ secrets.GITHUB_TOKEN }}` token can be used only when all project columns being accessed live in the target repository.  For organization or user owned projects, a personal access token will need to be used that has the following permissions at a minimum:
1. `write:org` to update organization projects
2. `repo` to access information in private repositories
3. `user` to access information in user repositories (if needed)

### Filtering mirrored cards

##### Manual filtering

`<!-- mirror ignore -->`

Filters cards based on the existence of a mirror ignore comment in the card content.  The comment can be added to card notes, or to linked issue or PR bodies.

When added to cards in the source project column, the cards will be ignored and not added to the target column.  When added to cards in the target project column, the cards will be ignored and will not be removed from the target column.

##### Filtering on action inputs

Cards can be filtered from mirroring by specifying additional inputs on the action workflow.

**type_filter**

Filters mirrored cards only to the specified type.  Must be one of
- `content` (linked issue or PR)
- `note`

**label_filter**

Filters mirrored cards based labels that match the input.  Note cards cannot be tagged with labels, and will never be filtered based on this input.

Label filters use exact, case sensitive comparisons to determine whether to mirror a card.  Label filter inputs can contain multiple labels separated by commas (`'first, second'`), and will be mirrored if any labels match (i.e. `OR` logic).

**content_filter**

Filters mirrored cards based on the displayed card content.  Issue/PR titles is evaluated when they are linked as cards, otherwise the card's note text is used.

Content filters use partial, case insensitive comparisons when determining which cards to mirror.  Content filter inputs can contain multiple filters separated by commas (`'first, second'`), and will be mirrored if any content matches are found (i.e. `OR` logic).  Content filters containing commas must be wrapped in quotes (`'first, second, "matching, with a comma"'`)

**state_filter**

Filters mirrored cards based on linked issue or PR state. Note cards do not have a state, and will never be filtered based on this input.  Must be one of:
- `open`
- `closed`
