# Contributing

Thank you for your interest in contributing to `pi-joplin`!

## Development Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd pi-joplin
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

## Running Tests

We use `jest` for our test suite, with a strict requirement of >=80% test coverage. 

To run the unit tests and view coverage:
```bash
npm run test
```

Please ensure that all tests pass and coverage requirements are met before submitting a pull request.

## Testing the Extension Locally

To test your local changes to the extension interactively in your `pi` environment:

```bash
# Run pi and load the extension directly from the source file
pi -e ./src/index.ts
```

This will spin up a new `pi` session with the `joplin_*` tools available for testing. You can use the prompt to ask `pi` to list your notebooks, read a note, or list notes by tag to verify your changes.
