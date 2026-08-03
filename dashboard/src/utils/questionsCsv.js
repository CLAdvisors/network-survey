import Papa from 'papaparse';

const COLUMN_NAMES = {
  name: 'question name',
  text: 'question title',
  type: 'question type',
  max: 'max answers',
  required: 'required',
};

const valueAt = (row, index) => (index >= 0 ? row[index] : undefined);

// CSV contract: no Required column is a legacy import (required=true). If the
// column is present, only "true" means required; blank and all other values mean false.
export const parseQuestionsCsv = (csvContent) => {
  const { data, errors } = Papa.parse(csvContent, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
  });

  if (errors.length > 0) {
    throw new Error(`Invalid questions CSV: ${errors[0].message}`);
  }
  if (data.length === 0) return [];

  const headers = data[0].map((header) => String(header).trim().toLowerCase());
  const indexes = Object.fromEntries(
    Object.entries(COLUMN_NAMES).map(([key, header]) => [key, headers.indexOf(header)]),
  );

  return data.slice(1).flatMap((values) => {
    const text = valueAt(values, indexes.text);
    if (text === undefined || text === null || text === '') return [];

    const name = valueAt(values, indexes.name);
    const type = valueAt(values, indexes.type);
    const max = valueAt(values, indexes.max);
    const required = valueAt(values, indexes.required);

    return [{
      name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
      text: String(text),
      type: typeof type === 'string' && type.trim() ? type.trim() : 'tagbox',
      max: typeof max === 'string' && max.trim() ? max.trim() : null,
      required: indexes.required === -1
        ? true
        : typeof required === 'string' && required.trim().toLowerCase() === 'true',
    }];
  });
};

export const formatQuestionsCsv = (rows) => Papa.unparse([
  ['Title', 'Question name', 'Question title', 'Question type', 'Max answers', 'Required'],
  ...[...rows].sort((a, b) => a.id - b.id).map((row, index) => [
    index === 0 ? 'Survey Title' : '',
    row.name || `question_${index + 1}`,
    row.text,
    row.type,
    row.max ?? '',
    row.required === true ? 'true' : 'false',
  ]),
]);
