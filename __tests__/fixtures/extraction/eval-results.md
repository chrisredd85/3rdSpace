# Document Extraction Fixture Eval Results

Generated: 2026-05-28T22:40:23.709Z
Agent: document_extraction / gpt-4o

## Summary

- Value accuracy within 5%: 10/10
- Confidence matches expected label: 10/10
- Exact value+confidence pass: 10/10

## Results

| Fixture | Mode | Expected | Extracted | Expected confidence | Actual confidence | Value pass | Confidence pass | Basis | Reasoning |
|---|---|---:|---:|---|---|---:|---:|---|---|
| eventbrite-checked-in.png | headcount | 58 | 58 | high | high | PASS | PASS | checked_in | The image clearly shows a 'Checked in' count labeled as 'Verified scanned attendees', which is the preferred metric for attendance. |
| eventbrite-rsvp-only.png | headcount | 74 | 74 | low | low | PASS | PASS | rsvp_only | The only available number is 'Registered' with no check-in or scanned count shown, which defaults to low confidence. |
| eventbrite-attendees.csv | headcount | 58 | 58 | high | high | PASS | PASS | checked_in_rows | The CSV data includes a 'checked_in' column with boolean values. There are 58 entries marked as 'true', indicating verified attendance. |
| eventbrite-ticket-sales.pdf | headcount | 87 | 87 | high | high | PASS | PASS | ticket_count | The document provides a clearly labeled 'Tickets sold' count, which is used as the headcount value in the absence of verified attendance data. |
| luma-rsvp.png | headcount | 41 | 41 | medium | medium | PASS | PASS | rsvp_only | The image shows an RSVP count labeled as 'Going' with 41 people, but it specifies that check-in data is not available, making it a fallback count. |
| partiful-going.png | headcount | 36 | 36 | medium | medium | PASS | PASS | rsvp_only | The image shows an 'RSVP only' count labeled as 'Going', which is used as a fallback when no verified attendance data is available. |
| square-summary-1.png | venue_revenue | 428000 | 428000 | high | high | PASS | PASS | net_sales_cents | The image clearly labels 'Net sales' as $4,280.00, which is the preferred revenue metric. |
| square-summary.xlsx | venue_revenue | 428000 | 428000 | high | high | PASS | PASS | net_sales_cents | The document provides a clearly labeled 'Net Sales' amount, which is the preferred metric for venue revenue. The amount is $4,280.00, which converts to 428000 cents. |
| toast-revenue.pdf | venue_revenue | 582450 | 582450 | high | high | PASS | PASS | net_sales_cents | The document provides a clearly labeled 'Net sales' amount before tips and taxes, which is the preferred metric for venue revenue. |
| handwritten-tab.jpg | venue_revenue | 94750 | 94750 | low | low | PASS | PASS | handwritten_total_cents | The total is handwritten and labeled with a question mark, indicating uncertainty. Handwritten totals are always low confidence. |

## Recommendations

- Extraction values are acceptable for all current synthetic fixtures.
- Confidence labels match the current expectations for all value-passing fixtures.
