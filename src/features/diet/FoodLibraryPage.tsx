import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { DietTag, FoodItem } from '../../types/fittrack';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

const CATEGORIES: Array<{ value: 'ALL' | DietTag; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'VEG', label: 'Veg' },
  { value: 'NON_VEG', label: 'Non-Veg' },
  { value: 'VEGAN', label: 'Vegan' },
  { value: 'SUPPLEMENT', label: 'Supplement' },
];

const EMPTY_FOOD = {
  name: '',
  category: 'VEG' as DietTag,
  servingLabel: '100g',
  servingGrams: '100',
  calories: '',
  proteinG: '',
  carbsG: '',
  fatG: '',
  priceInr: '',
};

interface FoodLibraryPageProps {
  onQuickLogFood?: (food: FoodItem) => void;
  onLibraryChanged?: () => void;
}

export function FoodLibraryPage({ onQuickLogFood, onLibraryChanged }: FoodLibraryPageProps) {
  const { showToast } = useToast();
  const { dataVersion, bumpDataVersion } = useWorkspace();
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | DietTag>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FOOD);

  const loadFoods = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<FoodItem[]>('/foods');
      setFoods(res.data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load foods.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadFoods();
  }, [loadFoods, dataVersion]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FOOD);
    setModalOpen(true);
  };

  const openEdit = (food: FoodItem) => {
    setEditingId(food.id);
    setForm({
      name: food.name,
      category: food.category,
      servingLabel: food.servingLabel,
      servingGrams: String(food.servingGrams),
      calories: String(food.calories),
      proteinG: String(food.proteinG),
      carbsG: String(food.carbsG),
      fatG: String(food.fatG),
      priceInr: String(food.priceInr),
    });
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        servingLabel: form.servingLabel.trim(),
        servingGrams: Number(form.servingGrams),
        calories: Number(form.calories),
        proteinG: Number(form.proteinG),
        carbsG: Number(form.carbsG),
        fatG: Number(form.fatG),
        priceInr: Number(form.priceInr || 0),
      };
      if (editingId) {
        await api.put(`/foods/${editingId}`, payload);
        showToast('Food updated.', 'success');
      } else {
        await api.post('/foods', payload);
        showToast('Food added to library.', 'success');
      }
      setModalOpen(false);
      await loadFoods();
      bumpDataVersion('diet');
      onLibraryChanged?.();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save food.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/foods/${id}`);
      setFoods((prev) => prev.filter((f) => f.id !== id));
      bumpDataVersion('diet');
      onLibraryChanged?.();
      showToast('Food removed.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete food.', 'error');
    }
  };

  const filtered = foods.filter((f) => {
    const matchesCat = categoryFilter === 'ALL' || f.category === categoryFilter;
    const matchesQuery = f.name.toLowerCase().includes(search.toLowerCase().trim());
    return matchesCat && matchesQuery;
  });

  if (loading) return <LoadingSpinner label="Loading food library..." />;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 text-[#626C7B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search foods (e.g. Paneer, Oats, Chicken)..."
              className="w-full h-9 rounded-[9px] bg-[#0D121A] border border-[#252D38] pl-9 pr-3 text-sm text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38]">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategoryFilter(c.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-[6px] transition-colors whitespace-nowrap cursor-pointer ${
                  categoryFilter === c.value
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4" />
          Add Food
        </Button>
      </Card>

      <Card className="p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No matching foods found"
              description="Try clearing your search filter or add a custom food with macros and INR price."
              action={
                <Button size="sm" variant="secondary" onClick={openCreate}>
                  Add Custom Food
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#202733] text-[11px] font-medium text-[#626C7B]">
                  <th className="py-2.5 px-4">Food Item</th>
                  <th className="py-2.5 px-3 hidden sm:table-cell">Serving</th>
                  <th className="py-2.5 px-3 text-right">Calories</th>
                  <th className="py-2.5 px-3 text-right">Protein</th>
                  <th className="py-2.5 px-3 text-right hidden md:table-cell">Carbs</th>
                  <th className="py-2.5 px-3 text-right hidden md:table-cell">Fat</th>
                  <th className="py-2.5 px-3 text-right">Cost</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202733] text-sm">
                {filtered.map((food) => (
                  <tr key={food.id} className="hover:bg-[#171E29]/60 transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-[#F5F7FA]">{food.name}</div>
                      <div className="text-[11px] text-[#626C7B]">
                        {food.category.replace('_', '-')}
                        <span className="sm:hidden"> · {food.servingLabel}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-[#929BAA] hidden sm:table-cell">
                      {food.servingLabel}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#F3B84B]">
                      {food.calories}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#62A8F7]">
                      {food.proteinG}g
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#A88AF5] hidden md:table-cell">
                      {food.carbsG}g
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#F18C72] hidden md:table-cell">
                      {food.fatG}g
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#39C9BA]">
                      ₹{food.priceInr}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {onQuickLogFood && (
                          <button
                            type="button"
                            onClick={() => onQuickLogFood(food)}
                            className="inline-flex items-center gap-1 rounded-[7px] bg-[#26351D] px-2 py-1 text-[11px] font-medium text-[#B6F36A] hover:bg-[#2F4224] cursor-pointer mr-1"
                            title={`Log ${food.name} today`}
                          >
                            <Check className="h-3 w-3" />
                            Log
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(food)}
                          className="p-1.5 rounded-md text-[#929BAA] hover:bg-[#171E29] hover:text-[#F5F7FA] cursor-pointer"
                          aria-label={`Edit ${food.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(food.id)}
                          className="p-1.5 rounded-md text-[#929BAA] hover:bg-[#171E29] hover:text-[#F16C75] cursor-pointer"
                          aria-label={`Delete ${food.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Food Item' : 'Add Food to Library'}
        subtitle="Define serving unit, macros, and cost in INR."
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Food Name"
            placeholder="e.g. Besan Chilla"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as DietTag })}
              options={[
                { value: 'VEG', label: 'Vegetarian' },
                { value: 'NON_VEG', label: 'Non-Vegetarian' },
                { value: 'VEGAN', label: 'Vegan' },
                { value: 'SUPPLEMENT', label: 'Supplement' },
              ]}
            />
            <Input
              label="Serving Unit Label"
              placeholder="e.g. 1 bowl (150g)"
              value={form.servingLabel}
              onChange={(e) => setForm({ ...form, servingLabel: e.target.value })}
              required
            />
            <Input
              label="Serving Weight (g)"
              type="number"
              step="0.1"
              value={form.servingGrams}
              onChange={(e) => setForm({ ...form, servingGrams: e.target.value })}
              required
            />
            <Input
              label="Price (INR ₹)"
              type="number"
              step="0.5"
              value={form.priceInr}
              onChange={(e) => setForm({ ...form, priceInr: e.target.value })}
              required
            />
            <Input
              label="Calories (kcal)"
              type="number"
              value={form.calories}
              onChange={(e) => setForm({ ...form, calories: e.target.value })}
              required
            />
            <Input
              label="Protein (g)"
              type="number"
              step="0.1"
              value={form.proteinG}
              onChange={(e) => setForm({ ...form, proteinG: e.target.value })}
              required
            />
            <Input
              label="Carbs (g)"
              type="number"
              step="0.1"
              value={form.carbsG}
              onChange={(e) => setForm({ ...form, carbsG: e.target.value })}
              required
            />
            <Input
              label="Fat (g)"
              type="number"
              step="0.1"
              value={form.fatG}
              onChange={(e) => setForm({ ...form, fatG: e.target.value })}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Food'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
