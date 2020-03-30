const projectCardFields = `
id
note
content {
  ... on Issue {
    id
  }
  ... on PullRequest {
    id
  }
}
`.trim()

const projectColumnFields = `
id
name
url
project {
  name
  url
}
cards(first: $cardLimit) {
  nodes {
    ${projectCardFields}
  }
}
`.trim()

export const GET_PROJECT_COLUMNS = `
query($sourceColumnId: ID!, $targetColumnId: ID!, $cardLimit: Int!) {
  sourceColumn: node(id: $sourceColumnId) {
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
`.trim()

export const ADD_PROJECT_CARD = `
mutation addProjectCard($columnId: ID!, $contentId: ID, $note: String) {
  addProjectCard(input: { projectColumnId: $columnId, contentId: $contentId, note: $note }) {
    cardEdge {
      node {
        ${projectCardFields}
      }
    }
  }
}
`.trim()

export const MOVE_PROJECT_CARD = `
mutation moveProjectCard($cardId: ID!, $columnId: ID!, $afterCardId: ID) {
  moveProjectCard(input: { cardId: $cardId, columnId: $columnId, afterCardId: $afterCardId }) {
    cardEdge {
      node {
        ${projectCardFields}
      }
    }
  }
}
`.trim()

export const DELETE_PROJECT_CARD = `
mutation deleteProjectCard($cardId: ID!) {
  deleteProjectCard(input: { cardId: $cardId }) {
    deletedCardId
  }
}
`.trim()
