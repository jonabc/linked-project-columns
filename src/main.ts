import * as core from '@actions/core'
import {graphql} from '@octokit/graphql'
import * as queries from './graphql'

const AUTOMATION_NOTE_TEMPLATE: string = `
**DO NOT EDIT**
This column uses automation to mirror the ['<column name>' column](<column url>) from [<project name>](<project url>).
`.trim()

const github = graphql.defaults({
  headers: {
    authorization: `token ${core.getInput('github_token')}`
  }
})

async function getAutomationNote(column: any): Promise<string> {
  return AUTOMATION_NOTE_TEMPLATE.replace('<column name>', column.name)
    .replace('<column url>', column.url.replace('/columns/', '#column-'))
    .replace('<project name>', column.project.name)
    .replace('<project url>', column.project.url)
}

function findCard(card: any, column: any): any[] {
  let index
  if (card.content) {
    index = column.cards.nodes.findIndex(
      (targetCard: any): boolean =>
        targetCard.content && targetCard.content.id === card.content.id
    )
  } else {
    index = column.cards.nodes.findIndex(
      (targetCard: any): boolean =>
        targetCard.note && targetCard.note === card.note
    )
  }

  return [column.cards.nodes[index], index]
}

async function ensureCard(
  card: any,
  index: number,
  targetColumn: any
): Promise<any> {
  let [targetCard, targetCardIndex] = findCard(card, targetColumn)
  let afterCardId: string | null = null
  if (index > 0) {
    afterCardId = targetColumn.cards.nodes[index - 1].id
  }

  if (!targetCard) {
    // add!
    const cardData: any = {}
    if (card.content) {
      cardData.contentId = card.content.id
    } else {
      cardData.note = card.note
    }

    const response = await github(queries.ADD_PROJECT_CARD, {
      columnId: targetColumn.id,
      ...cardData
    })

    if (!response) {
      throw new Error(`unable to add card with ${cardData}`)
    }

    // add new card to local array and set index appropriately
    targetCard = response['addProjectCard'].cardEdge.node
    targetColumn.cards.nodes.unshift(targetCard)
    targetCardIndex = 0
  }

  if (targetCardIndex !== index) {
    // move!
    const moveData = {
      cardId: targetCard.id,
      columnId: targetColumn.id,
      afterCardId
    }

    await github(queries.MOVE_PROJECT_CARD, moveData)

    // update the target column card location in the local card array
    targetColumn.cards.nodes.splice(
      index,
      0,
      targetColumn.cards.nodes.splice(targetCardIndex, 1)[0]
    )
    targetCardIndex = index
  }

  return targetCard
}

// content filters are parsed from a string either as wrapped in quotes or comma separated
const FILTER_LIST_REGEX = /\s*(?:((["'])([^\2]+?)\2)|([^"',]+))\s*/g
function getFilterList(input: string): string[] {
  if (!input) {
    return []
  }

  return [...input.matchAll(FILTER_LIST_REGEX)]
    .map(match => match[3] || match[4])
    .map(filter => filter.trim())
    .filter(filter => !!filter)
}

function applyFilters(column: any): void {
  const typeFilter = core.getInput('type_filter', {required: false})
  if (typeFilter === 'note') {
    column.cards.nodes = column.cards.nodes.filter(card => !!card.note)
  } else if (typeFilter === 'content') {
    column.cards.nodes = column.cards.nodes.filter(card => !!card.content)
  } else if (typeFilter) {
    core.warning(`cannot apply unknown type_filter ${typeFilter}`)
  }

  const contentFilters = getFilterList(
    core.getInput('content_filter', {required: false})
  )
  if (contentFilters.length > 0) {
    // match content in case-insensitive manner
    const contentMatchers = contentFilters.map(
      filter => new RegExp(filter, 'i')
    )

    // filter to cards with displayed text content that matches at least one
    // of the user-supplied filters
    column.cards.nodes = column.cards.nodes.filter((card: any): boolean => {
      if (card.content) {
        return contentMatchers.some(filter => filter.test(card.content.title))
      } else if (card.note) {
        return contentMatchers.some(filter => filter.test(card.note))
      }

      // don't filter cards that cannot be filtered by content
      return true
    })
  }

  const labelFilters = getFilterList(
    core.getInput('label_filter', {required: false})
  )
  if (labelFilters.length > 0) {
    column.cards.nodes = column.cards.nodes.filter((card: any): boolean => {
      if (card.content) {
        // only include cards for issues and PRs that have a matching label
        return card.content.labels.nodes.some(label =>
          labelFilters.includes(label.name)
        )
      }

      // don't filter cards that can't be filtered by labels
      return true
    })
  }
}

async function run(): Promise<void> {
  try {
    const sourceColumnId = core.getInput('source_column_id')
    const targetColumnId = core.getInput('target_column_id')

    const response = await github(queries.GET_PROJECT_COLUMNS, {
      sourceColumnId,
      targetColumnId,
      cardLimit: 100
    })
    if (!response) {
      throw new Error('unable to find project columns')
    }

    const sourceColumn = response['sourceColumn']
    const targetColumn = response['targetColumn']

    // apply user supplied filters to cards from the source column and mirror the
    // target column based on the remaining filters
    applyFilters(sourceColumn)

    // make sure that a card explaining the automation on the column exists
    // at index 0 in the target column
    const automationNoteCard: any = {
      note: await getAutomationNote(sourceColumn)
    }
    await ensureCard(automationNoteCard, 0, targetColumn)

    // delete all cards in target column that do not exist in the source column,
    // except for the automation note
    // don't iterate over index 0, to account for the automation note card
    for (let index = targetColumn.cards.nodes.length - 1; index >= 1; index--) {
      const targetCard = targetColumn.cards.nodes[index]
      const [sourceCard] = findCard(targetCard, sourceColumn)

      if (!sourceCard) {
        await github(queries.DELETE_PROJECT_CARD, {cardId: targetCard.id})
        targetColumn.cards.nodes.splice(index, 1)
      }
    }

    // make sure cards from the source column are in target column, in the right
    // order
    for (let index = 0; index < sourceColumn.cards.nodes.length; index++) {
      const sourceCard = sourceColumn.cards.nodes[index]

      // offset the index to account for the automation note always being index
      // 0 in the target column
      await ensureCard(sourceCard, index + 1, targetColumn)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
