# Trusty Track

Trusty Track is a comprehensive race management system designed for pinewood derby style racing events. It handles racer registration, heat scheduling, result tracking, and championship advancement.

## 🚀 Getting Started

For unexpected issues or detailed setup instructions, please refer to the [Development Guide](docs/development.md).

### Quick Start

**Backend:**

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

## 📖 Documentation

- [Development Guide](docs/development.md) - Setup, testing, and troubleshooting.
- [Specification](SPEC.md) - Detailed requirements.
- [Design](DESIGN.md) - Architecture and data models.
- [Scheduling Algorithms](docs/scheduling-algorithms.md) - How heats are generated (PPC, etc).

## 🧪 Testing

Run backend tests:

```bash
pytest backend/
```

Run frontend tests:

```bash
cd frontend && npm test
```
