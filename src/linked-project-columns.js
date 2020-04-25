const core = require('@actions/core');
const { graphql } = require('@octokit/graphql');
const queries = require('./graphql');
const filters = require('./filters');

const AUTOMATION_NOTE_TEMPLATE = `
**DO NOT EDIT**
This column uses automation to mirror the ['<column name>' column](<column url>) from [<project name>](<project url>).
`.trim();

function getAutomationNote(column) {
  return AUTOMATION_NOTE_TEMPLATE.replace('<column name>', column.name)
    .replace('<column url>', column.url.replace('/columns/', '#column-'))
    .replace('<project name>', column.project.name)
    .replace('<project url>', column.project.url);
}

function findCard(card, cards) {
  let index;
  if (card.content) {
    index = cards.findIndex(targetCard => targetCard.content && targetCard.content.id === card.content.id);
  } else {
    index = cards.findIndex(targetCard => targetCard.note && targetCard.note === card.note);
  }

  return [cards[index], index];
}

async function addCard(api, card, column) {
  // add!
  const cardData = {};
  if (card.content) {
    cardData.contentId = card.content.id;
  } else {
    cardData.note = card.note;
  }

  const response = await api(queries.ADD_PROJECT_CARD, {
    columnId: column.id,
    ...cardData
  });
  return [response.addProjectCard.cardEdge.node, 0];
}

async function moveCard(api, card, columnId, afterCardId) {
  const moveData = {
    cardId: card.id,
    columnId,
    afterCardId
  };

  const response = await api(queries.MOVE_PROJECT_CARD, moveData);
  return response.moveProjectCard.cardEdge.node;
}

function applyFilters(cards, filterFunctions) {
  return filterFunctions.reduce((result, filter) => filter(result));
}

async function run() {
  try {
    const api = graphql.defaults({
      headers: {
        authorization: `token ${core.getInput('github_token')}`
      }
    });

    const sourceColumnId = core.getInput('source_column_id');
    const targetColumnId = core.getInput('target_column_id');

    const response = await api(queries.GET_PROJECT_COLUMNS, {
      sourceColumnId,
      targetColumnId,
      cardLimit: 100
    });

    // apply user supplied filters to cards from the source column and mirror the
    // target column based on the remaining filters
    const { sourceColumn, targetColumn } = response;
    const sourceCards = applyFilters(sourceColumn.cards.nodes, [...Object.values(filters)]);
    const targetCards = targetColumn.cards.nodes;

    // prepend the automation note card to the filtered source cards, so that
    // it will be created if needed in the target column.
    sourceCards.unshift({ note: getAutomationNote(sourceColumn) });

    // delete all cards in target column that do not exist in the source column,
    // except for the automation note
    for (let index = targetCards - 1; index >= 0; index -= 1) {
      const targetCard = targetCards[index];
      const [sourceCard] = findCard(targetCard, sourceCards);

      if (!sourceCard) {
        // this loop is dependent on ordering and cannot be parallelized
        // eslint-disable-next-line no-await-in-loop
        await api(queries.DELETE_PROJECT_CARD, { cardId: targetCard.id });
        targetCards.splice(index, 1);
      }
    }

    // make sure cards from the source column are in target column,
    // in the correct order
    for (let sourceIndex = 0; sourceIndex < sourceCards.length; sourceIndex += 1) {
      const sourceCard = sourceCards[sourceIndex];
      let [targetCard, targetIndex] = findCard(sourceCard, targetCards);

      // add the card if it doesn't yet exist
      if (!targetCard) {
        // this for loop cannot be parallelized, as it is dependent on ordering
        // eslint-disable-next-line no-await-in-loop
        [targetCard, targetIndex] = await addCard(api, sourceCard, targetColumn);

        // add new card to local array and set index based on it's index in the column
        targetCards.splice(targetIndex, 0, targetCard);
      }

      // move the card if it's not at the correct location
      if (targetIndex !== sourceIndex) {
        // since we are iterating through the list from 0 to length,
        // we can assume that
        let afterCardId = null;
        if (sourceIndex > 0) {
          afterCardId = targetCards[sourceIndex - 1].id;
        }

        // this for loop cannot be parallelized, as it is dependent on ordering
        // eslint-disable-next-line no-await-in-loop
        [targetCard] = await moveCard(api, targetCard, targetColumn.id, afterCardId);

        // remove the card from it's original index
        targetCards.splice(targetIndex, 1);
        // and add the card returned from moveCard at the destination index
        targetCards.splice(sourceIndex, 0, targetCard);
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = run;
