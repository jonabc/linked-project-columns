const core = require('@actions/core');

let api;
async function setAPI(newAPI) {
  api = newAPI;
}

const PROJECT_CARD_CONTENT_FIELDS = `
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

const PROJECT_CARD_FIELDS = `
id
note
content {
  ... on Issue {
    ${PROJECT_CARD_CONTENT_FIELDS}
  }
  ... on PullRequest {
    ${PROJECT_CARD_CONTENT_FIELDS}
  }
}
`.trim();

const PROJECT_COLUMN_FIELDS = `
id
name
url
project {
  name
}
cards(first: 50, archivedStates: [NOT_ARCHIVED], after: $after) {
  nodes {
    ${PROJECT_CARD_FIELDS}
  }
  pageInfo {
    hasNextPage
    endCursor
  }
}
`.trim();

const GET_SINGLE_PROJECT_COLUMN = `
query($id: ID!, $after: String) {
  column: node(id: $id) {
    ... on ProjectColumn {
      ${PROJECT_COLUMN_FIELDS}
    }
  }
}
`.trim();

// Paginate project cards from all columns if/as needed
async function paginateColumnCards(columns) {
  for (let i = 0; i < columns.length; i += 1) {
    const originalColumn = columns[i];

    let currentColumn = originalColumn;
    while (currentColumn.cards.pageInfo.hasNextPage) {
      core.info(
        `paginating ${currentColumn.project.name}:${currentColumn.name} after ${currentColumn.cards.pageInfo.endCursor}`
      );

      // eslint-disable-next-line no-await-in-loop
      const { column } = await api(GET_SINGLE_PROJECT_COLUMN, {
        id: currentColumn.id,
        after: currentColumn.cards.pageInfo.endCursor
      });

      originalColumn.cards.nodes.push(...column.cards.nodes);
      currentColumn = column;
    }
  }
}

const GET_PROJECT_COLUMNS = `
query($sourceColumnIds: [ID!]!, $targetColumnId: ID!, $after: String) {
  sourceColumns: nodes(ids: $sourceColumnIds) {
    ... on ProjectColumn {
      ${PROJECT_COLUMN_FIELDS}
    }
  }
  targetColumn: node(id: $targetColumnId) {
    ... on ProjectColumn {
      ${PROJECT_COLUMN_FIELDS}
    }
  }
}
`.trim();

async function getProjectColumns(sourceColumnIds, targetColumnId) {
  const { sourceColumns, targetColumn } = await api(GET_PROJECT_COLUMNS, {
    sourceColumnIds,
    targetColumnId
  });

  // paginate to gather all cards if needed
  await paginateColumnCards([...sourceColumns, targetColumn]);

  return { sourceColumns, targetColumn };
}

const ADD_PROJECT_CARD = `
mutation addProjectCard($columnId: ID!, $contentId: ID, $note: String) {
  addProjectCard(input: { projectColumnId: $columnId, contentId: $contentId, note: $note }) {
    cardEdge {
      node {
        ${PROJECT_CARD_FIELDS}
      }
    }
  }
}
`.trim();

// Call the GitHub API to add a card to a project column
// Returns an array of [added card, index card was added at]
async function addCardToColumn(column, card) {
  const cardData = {};
  if (card.content) {
    cardData.contentId = card.content.id;
  } else {
    cardData.note = card.note;
  }

  try {
    const response = await api(ADD_PROJECT_CARD, {
      columnId: column.id,
      ...cardData
    });

    return response.addProjectCard.cardEdge.node;
  } catch (error) {
    core.warning(`Could not add card for payload ${JSON.stringify(cardData)}`);
    core.warning(error.message);
    return null;
  }
}

const MOVE_PROJECT_CARD = `
mutation moveProjectCard($cardId: ID!, $columnId: ID!, $afterCardId: ID) {
  moveProjectCard(input: { cardId: $cardId, columnId: $columnId, afterCardId: $afterCardId }) {
    cardEdge {
      node {
        ${PROJECT_CARD_FIELDS}
      }
    }
  }
}
`.trim();

// Call the GitHub API to move a card in a project column
// Returns the moved card.
async function moveCardToIndex(column, fromIndex, toIndex) {
  if (toIndex === fromIndex) {
    return column.cards.nodes[toIndex];
  }

  let afterCardId = null;
  if (toIndex >= column.cards.nodes.length) {
    afterCardId = column.cards.nodes[column.cards.nodes.length - 1].id;
  } else if (toIndex > 0) {
    if (toIndex > fromIndex) {
      // if toIndex > fromIndex, e.g. moving from index 0 to index 1,
      // then the "after card" is the card currently at index 1
      afterCardId = column.cards.nodes[toIndex].id;
    } else {
      // if toIndex < fromIndex, e.g. moving from index 2 to index 1,
      // then the "after card" is the card currently at index 0
      afterCardId = column.cards.nodes[toIndex - 1].id;
    }
  }

  const moveData = {
    cardId: column.cards.nodes[fromIndex].id,
    columnId: column.id,
    afterCardId
  };

  const response = await api(MOVE_PROJECT_CARD, moveData);
  return response.moveProjectCard.cardEdge.node;
}

const DELETE_PROJECT_CARD = `
mutation deleteProjectCard($cardId: ID!) {
  deleteProjectCard(input: { cardId: $cardId }) {
    deletedCardId
  }
}
`.trim();

async function deleteCardAtIndex(column, index) {
  const card = column.cards.nodes[index];
  const response = await api(DELETE_PROJECT_CARD, { cardId: card.id });
  return response.deleteProjectCard.deletedCardId;
}

module.exports = {
  setAPI,
  getProjectColumns,
  addCardToColumn,
  moveCardToIndex,
  deleteCardAtIndex,
  queries: {
    GET_PROJECT_COLUMNS,
    GET_SINGLE_PROJECT_COLUMN,
    ADD_PROJECT_CARD,
    MOVE_PROJECT_CARD,
    DELETE_PROJECT_CARD
  }
};
