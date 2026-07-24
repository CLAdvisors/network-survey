// CSV contract: no Required column is a legacy import (required=true). If the
// column is present, only "true" means required; blank and all other values mean false.
export const parseQuestionsCsv = (csvContent) => {
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const splitCsvLine = (line) => line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const requiredIndex = headers.indexOf('required');
  const questions = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i]);
    const text = values[2] ? values[2].replace(/^"|"$/g, '') : '';
    if (!text) continue;
    questions.push({
      name: values[1]?.trim() || undefined,
      text,
      type: values[3]?.trim() || 'tagbox',
      max: values[4]?.trim() || null,
      required: requiredIndex === -1 ? true : values[requiredIndex]?.trim().toLowerCase() === 'true',
    });
  }
  return questions;
};

export const formatQuestionsCsv = (rows) => {
  const csvRows = ['Title,Question name,Question title,Question type,Max answers,Required'];
  [...rows].sort((a, b) => a.id - b.id).forEach((row, index) => {
    csvRows.push([
      index === 0 ? 'Survey Title' : '',
      row.name || `question_${index + 1}`,
      `"${row.text}"`,
      row.type,
      row.max || '',
      row.required === true ? 'true' : 'false',
    ].join(','));
  });
  return csvRows.join('\n');
};
