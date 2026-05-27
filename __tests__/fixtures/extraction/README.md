# Extraction Fixtures

These files are deterministic mock inputs for revenue share settlement QA. They contain generated/anonymized data only.

| File | Expected extraction |
|---|---|
| `eventbrite-checked-in-58.png` | 58 checked_in, high confidence |
| `eventbrite-only-rsvps.png` | 120 registered, medium confidence, no check-in data |
| `luma-going-87.png` | 87 rsvp, medium confidence |
| `partiful-going.png` | 45 rsvp, medium confidence |
| `square-net-4280.png` | $4,280.00 net sales, high confidence |
| `toast-net-3140.png` | $3,140.00 net sales, high confidence |
| `clover-summary.png` | $2,800.00 net sales, high confidence |
| `handwritten-tab.jpg` | $890.00 total, low confidence |
| `eventbrite-attendees.csv` | 58 checked_in rows |
| `toast-revenue.xlsx` | $3,140.00 in `Daily Summary!B7` |
| `pos-report.pdf` | $4,280.00 text-extractable net sales |
| `scanned-receipt.pdf` | $890.00 via rendered vision, low confidence |
| `encrypted.pdf` | null, low confidence, PDF is password-protected |
| `empty.csv` | null, low confidence, no data |

Current implementation note: these fixtures are committed before the extraction routes/agent exist, so they are test inputs for the next implementation slice rather than passing end-to-end coverage by themselves.
