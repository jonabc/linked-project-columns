const core = require('@actions/core');
const octokit = require('@octokit/graphql');
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

// Find a card in an array of cards based on it's linked content, or it's note.
// Returns an array of [found card, index of found card]
function findCard(card, cards) {
  let index = -1;
  if (card.content) {
    index = cards.findIndex(targetCard => targetCard.content && targetCard.content.id === card.content.id);
  } else {
    index = cards.findIndex(targetCard => targetCard.note && targetCard.note === card.note);
  }

  if (index < 0) {
    return [null, index];
  }

  return [cards[index], index];
}

// Call the GitHub API to add a card to a project column
// Returns an array of [added card, index card was added at]
async function addCard(api, card, column) {
  const cardData = {};
  if (card.content) {
    cardData.contentId = card.content.id;
  } else {
    cardData.note = card.note;
  }

  try {
    const response = await api(queries.ADD_PROJECT_CARD, {
      columnId: column.id,
      ...cardData
    });
    return [response.addProjectCard.cardEdge.node, 0];
  } catch (error) {
    core.warning(`Could not add card for payload ${JSON.stringify(cardData)}`);
    core.warning(error.message);
    return [null, -1];
  }
}

// Call the GitHub API to move a card in a project column
// Returns the moved card.
async function moveCard(api, card, column, afterCard) {
  const moveData = {
    cardId: card.id,
    columnId: column.id,
    afterCardId: afterCard ? afterCard.id : null
  };

  const response = await api(queries.MOVE_PROJECT_CARD, moveData);
  return response.moveProjectCard.cardEdge.node;
}

// Apply an array of filters to an array of cards.
// Returns an array of filtered cards.  Does not mutate the original cards array.
function applyFilters(cards, filterFunctions) {
  return filterFunctions.reduce((result, filter) => filter(result), cards);
}

async function run() {
  try {
    const api = octokit.graphql.defaults({
      headers: {
        authorization: `token ${core.getInput('github_token', { required: true })}`
      }
    });

    const sourceColumnId = core.getInput('source_column_id', { required: true });
    const targetColumnId = core.getInput('target_column_id', { required: true });

    const response = await api(queries.GET_PROJECT_COLUMNS, {
      sourceColumnId,
      targetColumnId,
      cardLimit: 100
    });

    // apply user supplied filters to cards from the source column and mirror the
    // target column based on the remaining filters
    const { sourceColumn, targetColumn } = response;
    const sourceCards = applyFilters(sourceColumn.cards.nodes, [...Object.values(filters)]);
    const targetCards = applyFilters(targetColumn.cards.nodes, [filters.ignored]);

    // prepend the automation note card to the filtered source cards, so that
    // it will be created if needed in the target column.
    const addNoteInput = core.getInput('add_note');
    if (addNoteInput.toLowerCase() === 'true') {
      sourceCards.unshift({ note: getAutomationNote(sourceColumn) });
    }

    // delete all cards in target column that do not exist in the source column,
    // except for the automation note
    for (let index = targetCards.length - 1; index >= 0; index -= 1) {
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

      // since we are iterating through the list from 0 to length,
      // we can assume that the targetCards array less than source index is
      // in the proper order.
      // this card needs to be found before further mutating the target cards
      // array during this loop iteration
      let afterCard = null;

      if (sourceIndex > targetCards.length) {
        afterCard = targetCards[targetCards.length - 1];
      } else if (sourceIndex > 0) {
        afterCard = targetCards[sourceIndex - 1];
      }

      // add the card if it doesn't yet exist
      if (!targetCard) {
        // this for loop cannot be parallelized, as it is dependent on ordering
        // eslint-disable-next-line no-await-in-loop
        [targetCard, targetIndex] = await addCard(api, sourceCard, targetColumn);

        // add new card to local array and set index based on it's index in the column
        if (targetCard) {
          targetCards.splice(targetIndex, 0, targetCard);
        }
      }

      // move the card if it's not at the correct location
      if (targetCard && targetIndex !== sourceIndex) {
        // this for loop cannot be parallelized, as it is dependent on ordering
        // eslint-disable-next-line no-await-in-loop
        targetCard = await moveCard(api, targetCard, targetColumn, afterCard);

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
