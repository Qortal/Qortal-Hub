
# 🤝 Contributing Guide

Thank you for your interest in contributing! We follow a structured Git workflow to keep the project clean, stable, and production-ready at all times.

---

## 📦 Branch Overview

| Branch           | Purpose                                                  |
|------------------|----------------------------------------------------------|
| `master`         | Stable, production-ready code. All releases are tagged from here. |
| `develop`        | Active development branch. All new features go here first. |
| `release/x.y.z`  | Pre-release branch for staging, QA, and final polish.     |

---

## 🌿 Creating a Feature or Fix

1. **Start from `develop`:**

   ```bash
   git checkout develop
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes and commit them.**

3. **Push your branch:**

   ```bash
   git push origin feature/your-feature-name
   ```

4. **Open a Pull Request into `develop`.**

---

## 🚀 Releasing Code (Maintainers Only)

A new `release/x.y.z` branch must be created for **every release**.

1. **Create a `release/` branch from `master`:**

   ```bash
   git checkout master
   git checkout -b release/1.2.0
   ```

2. **Merge in `develop` or selected branches if `develop` is not ready:**

   ```bash
   git merge develop
   # or
   git merge feature/finished-feature
   git merge feature/another-complete-feature
   ```

3. **Polish, test, and fix issues as needed.**

4. **Merge back into `develop`:**

   ```bash
   git checkout develop
   git merge release/1.2.0
   git push origin develop
   ```

5. **Finalize the release:**

   ```bash
   git checkout master
   git merge release/1.2.0
   git tag v1.2.0
   git push origin master --tags
   ```

6. **Delete the release branch:**

   ```bash
   git branch -d release/1.2.0
   git push origin --delete release/1.2.0
   ```

