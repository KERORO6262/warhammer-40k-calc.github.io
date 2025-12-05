# Unit Power Scorer 40k (UPS-40k)

An **experimental fan project** designed to assist Warhammer 40,000 players in estimating unit efficiency for 10th Edition.

This tool provides a **theoretical scoring system** to help players visualize the potential strengths and weaknesses of their units. It converts raw stats into comparable scores for Offense, Defense, and Tactical utility.

🔗 **Live Tool:** [https://keroro6262.github.io/unit-power-scorer-40k/](https://keroro6262.github.io/unit-power-scorer-40k/)

## 📝 Project Goal

The goal is not to predict the exact outcome of a game, but to offer a **mathematical baseline** for list building. It helps answer questions like:
* *"On paper, does this unit deal enough damage against T10 targets?"*
* *"How does the durability of Unit A compare to Unit B?"*

## 📊 Features

* **Offense Estimator:** Calculates a score based on average dice probabilities, factoring in weapon strength (S), AP, and Damage against common toughness benchmarks (T4, T9, T12).
* **Durability Rating:** Provides a "Defense Score" that considers Wounds, Toughness, Save characteristics, and defensive buffs (FNP/Invuln).
* **Tactical Weight:** A simple metric to evaluate objective control capabilities (OC) and Leadership.
* **Keyword Support:** Includes basic logic for common keywords like **Lethal Hits**, **Devastating Wounds**, and **Sustained Hits**.

## ⚠️ Disclaimer

This tool is a **fan-made utility** for theory-crafting purposes only. 
* It uses **average expectations** (mathhammer) which does not account for luck, terrain, or complex stratagems in actual gameplay.
* The scoring weights are subjective estimates and should be used as a reference, not an absolute rule.
* Warhammer 40,000 is a trademark of Games Workshop Limited. This project is unaffiliated with GW.

## 🛠️ How to Use

1. Input your unit's stats and weapon profiles.
2. Select any active buffs (e.g., from Leaders).
3. Review the calculated scores to compare different loadout options.
