# Qortal Hub - Desktop Interface for Qortal

Qortal Hub is the newest interface for Qortal, part of the 'Qortal Trifecta' series of new User Interfaces for the platform/network. 

It is likely that Qortal Hub will become the new 'primary interface' for Qortal, and that the primary development focus surrounding Qortal Interface development, will be focused here instead of the previous 'qortal-ui' repo.

## Qortal Hub - Next-Level Secure Communications and More

Qortal Hub came along with the new Group Encryption methodologies applied, which provide **encrypted chat in Q-Chat for private groups.** Qortal Hub was the first to implement the new method of group encryption, which allows new users to see previously published data, unlike the previous group encryption methodology of things like 'threads' in Q-Mail.

Allowing new users to view older messages also comes along with a massive boost to the usability of the group encryption, and as such has been leveraged in multiple places inside Qortal Hub, Qortal Extension, and Qortal Go. 

## Ease of Use Expanded

Qortal Hub has a focus on ease of use for new users. Providing both the ability to utlilize Qortal without needing to run a local node (though running a local node is still the recommended method to access Qortal), and multiple built-in (QDN-published) walk-thru videos (by Qortal Justin) that explain the various basics of any given section of the application. This allows new users to 'jump right in' to utilizing Qortal Hub, and Qortal overall, in a much more streamlined fashion than that which was previously required by the 'legacy UI' (qortal-ui). 

Leveraging a redundant set of publicly accessible nodes provided by crowetic, Qortal Hub, Qortal Go, and Qortal Extension, all allow the use of Qortal without running a node, making it very simple to 'install and go' and start making use of the extensive functionality provided within the Qortal Ecosystem. 

Many additional details and a fully featured wiki will be created over time. Reach out on the chat on https://qortal.dev or in any of the community locations for Qortal, if you have any issues. Thank you!


# 🤝 Contributing Guide

Thank you for your interest in contributing! We follow a structured Git workflow to keep the project clean, stable, and production-ready at all times.

---

## 📦 Branch Overview

| Branch           | Purpose                                                  |
|------------------|----------------------------------------------------------|
| `master`         | Stable, production-ready code. All releases are tagged here. |
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

