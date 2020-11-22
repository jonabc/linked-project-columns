const projectCardContentFields = `
id
title
state
body
labels(first: 20) {
  nodes {
    name
  }
}
`.trim();

const projectCardFields = `
id
note
content {
  ... on Issue {
    ${projectCardContentFields}
  }
  ... on PullRequest {
    ${projectCardContentFields}
  }
}
`.trim();

const projectColumnFields = `
id
name
url
project {
  name
}
cards(first: 50, archivedStates: [NOT_ARCHIVED], after: $after) {
  nodes {
    ${projectCardFields}
  }
  pageInfo {
    hasNextPage
    endCursor
  }
}
`.trim();

const GET_PROJECT_COLUMNS = `
query($sourceColumnIds: [ID!]!, $targetColumnId: ID!, $after: String) {
  sourceColumns: nodes(ids: $sourceColumnIds) {
    ... on ProjectColumn {
      ${projectColumnFields}
    }
  }
  targetColumn: node(id: $targetColumnId) {
    ... on ProjectColumn {
      ${projectColumnFields}
    }
  }
}
`.trim();

const GET_SINGLE_PROJECT_COLUMN = `
query($id: ID!, $after: String) {
  column: node(id: $id) {
    ... on ProjectColumn {
      ${projectColumnFields}
    }
  }
}
`.trim();

const ADD_PROJECT_CARD = `
mutation addProjectCard($columnId: ID!, $contentId: ID, $note: String) {
  addProjectCard(input: { projectColumnId: $columnId, contentId: $contentId, note: $note }) {
    cardEdge {
      node {
        ${projectCardFields}
      }
    }
  }
}
`.trim();

const MOVE_PROJECT_CARD = `
mutation moveProjectCard($cardId: ID!, $columnId: ID!, $afterCardId: ID) {
  moveProjectCard(input: { cardId: $cardId, columnId: $columnId, afterCardId: $afterCardId }) {
    cardEdge {
      node {
        ${projectCardFields}
      }
    }
  }
}
`.trim();

const DELETE_PROJECT_CARD = `
mutation deleteProjectCard($cardId: ID!) {
  deleteProjectCard(input: { cardId: $cardId }) {
    deletedCardId
  }
}
`.trim();

module.exports = {
  GET_PROJECT_COLUMNS,
  GET_SINGLE_PROJECT_COLUMN,
  ADD_PROJECT_CARD,
  MOVE_PROJECT_CARD,
  DELETE_PROJECT_CARD
};
